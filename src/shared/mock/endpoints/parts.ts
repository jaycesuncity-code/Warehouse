import type { ApiErrorBody, Part, PartInput } from '../../contract';
import { notFound, validation } from '../errors';
import { buildPart, findPart } from '../format';
import { optionalLength, requireInt, requireNumber, requireString, requireVersion } from '../rules';
import type { PartRec } from '../state';
import { ok, type Handler } from '../types';

export const getPart: Handler = (c) => {
  const part = findPart(c.state, c.params.part_id);
  if (!part) throw notFound('That part');
  return ok(buildPart(c.state, part, c.role));
};

// ---- search -------------------------------------------------------------------------------

const norm = (v: string): string => v.toLowerCase();

function score(p: PartRec, q: string, tokens: string[]): number {
  const code = norm(p.part_code);
  const name = norm(p.part_name);
  const hay = [
    name,
    code,
    norm(p.category ?? ''),
    norm(p.description ?? ''),
    (p.aliases ?? []).map(norm).join(' '),
  ].join(' | ');
  if (!tokens.every((t) => hay.includes(t))) return -1;
  if (code === q) return 100;
  if (code.startsWith(q)) return 80;
  if (name.startsWith(q)) return 70;
  if (code.includes(q)) return 55;
  if (name.includes(q)) return 45;
  return 20;
}

export const searchParts: Handler = (c) => {
  const q = norm((c.query.get('q') ?? '').trim());
  const category = norm((c.query.get('category') ?? '').trim());
  const limit = Math.min(Math.max(parseInt(c.query.get('limit') ?? '25', 10) || 25, 1), 100);
  const offset = Math.max(parseInt(c.query.get('offset') ?? '0', 10) || 0, 0);
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = c.state.parts
    .filter((p) => p.active && (!category || norm(p.category ?? '') === category))
    .filter(p => c.query.get("unassigned") !== "true" || !c.state.stock.some(l => l.active && l.part_id === p.part_id))
    .map((p) => ({ p, s: tokens.length ? score(p, q, tokens) : 0 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.p.part_name.localeCompare(b.p.part_name));

  const items: Part[] = scored.slice(offset, offset + limit).map((x) => buildPart(c.state, x.p, c.role));
  return ok({ items, total: scored.length, limit, offset });
};

// ---- create / patch -----------------------------------------------------------------------

type Fields = Partial<Omit<PartRec, 'part_id' | 'active' | 'version'>>;

function readFields(body: Partial<PartInput>, partial: boolean): Fields {
  const f: Fields = {};
  if (!partial || body.part_code !== undefined) f.part_code = requireString(body.part_code, 'part_code');
  if (!partial || body.part_name !== undefined) f.part_name = requireString(body.part_name, 'part_name');
  if (body.category !== undefined)
    f.category = body.category === null ? null : String(body.category).trim() || null;
  if (body.description !== undefined) f.description = String(body.description ?? '');
  if (body.department !== undefined)
    f.department = body.department === null ? null : String(body.department).trim() || null;
  if (body.unit !== undefined) f.unit = String(body.unit || 'each');
  if (body.cost !== undefined)
    f.cost = body.cost === null ? null : requireNumber(body.cost, 'cost', { min: 0 });
  if (body.sale_price !== undefined)
    f.sale_price = body.sale_price === null ? null : requireNumber(body.sale_price, 'sale_price', { min: 0 });
  if (body.reorder_point !== undefined)
    f.reorder_point =
      body.reorder_point === null ? null : requireInt(body.reorder_point, 'reorder_point', { min: 0 });
  for (const k of ['width_in', 'height_in', 'depth_in', 'weight_lb'] as const) {
    if (body[k] !== undefined) f[k] = optionalLength(body[k], k);
  }
  if (body.aliases !== undefined)
    f.aliases = (body.aliases ?? []).map((a) => String(a).trim()).filter(Boolean);
  return f;
}

function assertCodeFree(parts: PartRec[], code: string, exceptId?: string): void {
  const clash = parts.find(
    (p) => p.active && p.part_id !== exceptId && p.part_code.toLowerCase() === code.toLowerCase(),
  );
  if (clash) throw validation({ part_code: `Already used by "${clash.part_name}".` });
}

export const createPart: Handler = (c) => {
  const f = readFields(c.body ?? {}, false);
  assertCodeFree(c.state.parts, f.part_code!);
  const part: PartRec = {
    part_id: c.tx.mint('prt'),
    part_code: f.part_code!,
    part_name: f.part_name!,
    category: f.category ?? null,
    description: f.description ?? '',
    department: f.department ?? null,
    unit: f.unit ?? 'each',
    cost: f.cost ?? null,
    sale_price: f.sale_price ?? null,
    reorder_point: f.reorder_point ?? null,
    width_in: f.width_in ?? null,
    height_in: f.height_in ?? null,
    depth_in: f.depth_in ?? null,
    weight_lb: f.weight_lb ?? null,
    aliases: f.aliases ?? [],
    active: true,
    version: 1,
  };
  c.tx.insert('parts', part);
  const ev = c.tx.finish('create', 'part', part.part_id);
  return ok({ part: buildPart(c.state, part, c.role), event_id: ev.event_id }, 201);
};

export const patchPart: Handler = (c) => {
  const part = findPart(c.state, c.params.part_id);
  if (!part) throw notFound('That part');
  requireVersion(c.body?.version, part, () => buildPart(c.state, part, c.role), 'This part');
  const f = readFields(c.body ?? {}, true);
  if (f.part_code) assertCodeFree(c.state.parts, f.part_code, part.part_id);
  c.tx.update('parts', part, (p) => Object.assign(p, f));
  const ev = c.tx.finish('edit', 'part', part.part_id);
  return ok({ part: buildPart(c.state, part, c.role), event_id: ev.event_id });
};

// ---- register (label generator batch) ----------------------------------------------------

export const registerParts: Handler = (c) => {
  const rows: Partial<PartInput>[] = Array.isArray(c.body?.rows) ? c.body.rows : [];
  if (!rows.length || rows.length > 500) throw validation({ rows: 'Send at least one row.' });
  const results: {
    index: number;
    status: 'reused' | 'new' | 'conflict';
    part_id: string | null;
    message?: string;
  }[] = [];
  let lastId = '';
  rows.forEach((row, index) => {
    const code = typeof row?.part_code === 'string' ? row.part_code.trim() : '';
    const name = typeof row?.part_name === 'string' ? row.part_name.trim() : '';
    if (!code || !name || code.length>150 || name.length>500) {
      results.push({ index, status: 'conflict', part_id: null, message: 'A part needs a code and a name.' });
      return;
    }
    const supplied=(row as Partial<PartInput> & {part_id?:unknown}).part_id;
    if(supplied !== undefined) {
      const found=c.state.parts.find(p=>p.part_id===supplied && p.active);
      if(!found || found.part_code.toLowerCase()!==code.toLowerCase() || found.part_name.trim().toLowerCase()!==name.toLowerCase()) {
        results.push({index,status:'conflict',part_id:null,message:'Imported ID does not match the catalog.'});return;
      }
    }
    const existing = c.state.parts.find((p) => p.part_code.toLowerCase() === code.toLowerCase());
    if (existing) {
      if (existing.active && existing.part_name.trim().toLowerCase() === name.toLowerCase()) {
        results.push({ index, status: 'reused', part_id: existing.part_id });
      } else {
        results.push({
          index,
          status: 'conflict',
          part_id: existing.part_id,
          message: `Code ${code} is already used by "${existing.part_name}".`,
        });
      }
      return;
    }
    const f = readFields(row, false);
    const part: PartRec = {
      part_id: c.tx.mint('prt'),
      part_code: f.part_code!,
      part_name: f.part_name!,
      category: f.category ?? null,
      description: f.description ?? '',
      department: f.department ?? null,
      unit: f.unit ?? 'each',
      cost: f.cost ?? null,
      sale_price: f.sale_price ?? null,
      reorder_point: f.reorder_point ?? null,
      width_in: f.width_in ?? null,
      height_in: f.height_in ?? null,
      depth_in: f.depth_in ?? null,
      weight_lb: f.weight_lb ?? null,
      aliases: f.aliases ?? [],
      active: true,
      version: 1,
    };
    c.tx.insert('parts', part);
    lastId = part.part_id;
    results.push({ index, status: 'new', part_id: part.part_id });
  });
  const created = results.filter((r) => r.status === 'new').length;
  const body: { results: typeof results; event_id: string | null } = { results, event_id: null };
  if (created) body.event_id = c.tx.finish('register', 'part', lastId, `${created} new`).event_id;
  return ok(body);
};

export type { ApiErrorBody };
