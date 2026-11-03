import type { D1 } from './database';
import type { Me } from '../../src/shared/contract';
import { mintId } from '../../src/shared/mock/mint';
import { readBoundedText } from './http';
import { readIdempotency } from './database';

type Row = Record<string, unknown>;
type P = 'order_equipment' | 'receive_edit_equipment' | 'print_labels' | 'manage_equipment_types' | 'manage_staff';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
const fail = (status: number, error: string, message: string, extra: Row = {}) => reply({ error, message, ...extra }, status);
const now = () => new Date().toISOString();
const str = (value: unknown, max = 250) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const normalized = (value: unknown) => str(value).replace(/\s+/g, ' ').toUpperCase();
const nameKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const similarityKey = (value: string) => nameKey(value).replace(/\b(llc|inc|corp|co|company|the)\b/g, '').replace(/\s+/g, ' ').trim();
const asObj = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const id = (prefix: 'eqp'|'ebt'|'ebl'|'cus'|'rev'|'evt'|'elp'|'ety') => mintId(prefix, () => false);
const number = (value: unknown) => typeof value === 'number' && Number.isInteger(value) ? value : -1;
const sql = (db: D1, query: string, ...params: unknown[]) => db.prepare(query).bind(...params);
const list = async (db: D1, query: string, ...params: unknown[]): Promise<Row[]> =>
  (await sql(db, query, ...params).all<Row>()).results;
const one = async (db: D1, query: string, ...params: unknown[]) => sql(db, query, ...params).first<Row>();

export async function permissions(db: D1, me: Me): Promise<string[]> {
  // Legacy role powers remain enforced by the existing API. New equipment rights are explicit.
  if (me.role === 'admin') return ['admin', 'order_equipment', 'receive_edit_equipment', 'print_labels', 'manage_equipment_types', 'manage_staff'];
  const rows = await list(db, 'SELECT p.permission FROM staff_permissions p JOIN staff_accounts s ON s.email=p.email WHERE s.email=? AND s.active=1', me.email);
  return rows.map(r => String(r.permission));
}
const allowed = (me: Me, rights: string[], p: P) => me.role === 'admin' || rights.includes(p);
function event(db: D1, actor: Me, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  return sql(db, 'INSERT INTO events(event_id,at,by,action,entity,entity_id,before,after,reason,undone_by) VALUES(?,?,?,?,?,?,?,?,?,NULL)',
    id('evt'), now(), actor.email, action, entity, entityId, JSON.stringify(before), JSON.stringify(after), null);
}
function review(db: D1, actor: Me, unitId: string, issue: string, details: Row) {
  return sql(db, 'INSERT OR IGNORE INTO warehouse_review_items(review_id,entity_type,entity_id,issue_code,severity,dedupe_key,detail_json,state,created_at,created_by) VALUES(?,?,?,?,?,?,?,\'open\',?,?)',
    id('rev'), 'equipment', unitId, issue, 'warning', issue, JSON.stringify(details), now(), actor.email);
}
function revision(db: D1, seq: number) {
  return sql(db, 'INSERT INTO warehouse_meta(id,revision,updated_at) VALUES(1,(SELECT revision+1 FROM warehouse_meta WHERE id=1 AND revision=?),?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at',
    seq, now());
}
async function commit(db: D1, statements: ReturnType<D1['prepare']>[], receipt?: { actor: string; key: string; hash: string; body: unknown; status: number }) {
  const row = await one(db, 'SELECT revision FROM warehouse_meta WHERE id=1');
  if (!row) throw new Error('warehouse revision missing');
  if (receipt) statements.push(sql(db, 'INSERT INTO idempotency_requests(actor,key,request_hash,response_status,response_body,response_headers,created_at) VALUES(?,?,?,?,?,?,?)',
    receipt.actor, receipt.key, receipt.hash, receipt.status, JSON.stringify(receipt.body), '{}', now()));
  await db.batch([revision(db, Number(row.revision)), ...statements]);
}
function insert(db: D1, table: string, data: Row) {
  const columns = Object.keys(data);
  return sql(db, `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, ...columns.map(k => data[k]));
}
const unitView = (r: Row) => r;
async function getUnit(db: D1, equipmentId: string) {
  return one(db, `SELECT e.*,c.display_name AS customer_name,c.is_stock,t.name AS type_name,t.serial_expected,
    b.entry_batch_id AS batch_id,l.ordered_qty FROM equipment e
    JOIN customers c ON c.customer_id=e.customer_id JOIN equipment_types t ON t.equipment_type_id=e.equipment_type_id
    LEFT JOIN equipment_entry_batches b ON b.entry_batch_id=e.entry_batch_id
    LEFT JOIN equipment_batch_lines l ON l.entry_line_id=e.entry_line_id WHERE e.equipment_id=?`, equipmentId);
}
function labelRecord(r: Row) {
  return { equipment_id:r.equipment_id, customer_name:r.customer_name, is_stock:r.is_stock, po_number:r.po_number,
    type_name:r.type_name, ordered_model:r.ordered_model, requested_by_name:r.requested_by_name, expected_date:r.expected_date,
    unit_index:r.unit_index, ordered_qty:r.ordered_qty };
}
const labelFingerprint = (value: unknown) => JSON.stringify(value);

async function hashRequest(request: Request, raw: string) {
  const bytes = new TextEncoder().encode(`${request.method}\n${new URL(request.url).pathname}${new URL(request.url).search}\n${raw}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function equipmentRoute(request: Request, db: D1, me: Me, rights: string[]): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace(/\/$/, '');
  const route = path.startsWith('/api/equipment') || path.startsWith('/api/customers') || path.startsWith('/api/staff');
  if (!route) return null;
  const method = request.method;
  if (method !== 'GET' && request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)
    return fail(403, 'forbidden', 'Cross-origin equipment changes are not allowed.');
  let body: Row = {}, receipt: { actor: string; key: string; hash: string; body: unknown; status: number } | undefined;
  try {
    if (method !== 'GET') {
      if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') ?? '')) return fail(415,'validation','Use JSON.');
      const raw = await readBoundedText(request, 1_000_000);
      body = asObj(JSON.parse(raw || '{}'));
      const key = request.headers.get('Idempotency-Key');
      if (key) {
        if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) return fail(400,'validation','Invalid Idempotency-Key.');
        const hash = await hashRequest(request, raw);
        const saved = await readIdempotency(db, key, me.email);
        if (saved) return saved.request_hash === hash
          ? reply(saved.response_body, saved.response_status)
          : fail(409,'idempotency_conflict','Retry key already used for a different request.');
        receipt = { actor: me.email, key, hash, body: null, status: 200 };
      }
    }
    const save = async (statements: ReturnType<D1['prepare']>[], result: unknown, status = 200) => {
      await commit(db, statements, receipt ? { ...receipt, body: result, status } : undefined);
      return reply(result, status);
    };
    if (path === '/api/equipment/types' && method === 'GET')
      return reply({ items: await list(db, 'SELECT * FROM equipment_types WHERE active=1 ORDER BY department,name') });
    if (path === '/api/equipment/types' && method === 'POST') {
      if (!allowed(me,rights,'manage_equipment_types')) return fail(403,'forbidden','Manage equipment types permission required.');
      const name = str(body.name,120), department = str(body.department,80);
      const departments = ['HVAC Service','HVAC Install','HVAC New Construction','Plumbing Service','Plumbing Install'];
      if (!name || !departments.includes(department)) return fail(400,'validation','Name and valid department are required.');
      const value = { equipment_type_id:id('ety'),name,department,serial_expected:body.serial_expected===false?0:1,
        default_manufacturer:str(body.default_manufacturer)||null,notes:str(body.notes,500),created_at:now(),updated_at:now() };
      return save([insert(db,'equipment_types',value),event(db,me,'create','equipment_type',value.equipment_type_id,{},value)],{item:value},201);
    }
    const typeEdit = path.match(/^\/api\/equipment\/types\/(ety-[a-z0-9]{8})$/);
    if (typeEdit && method === 'PATCH') {
      if (!allowed(me,rights,'manage_equipment_types')) return fail(403,'forbidden','Manage equipment types permission required.');
      const prior = await one(db,'SELECT * FROM equipment_types WHERE equipment_type_id=?',typeEdit[1]);
      if (!prior) return fail(404,'not_found','Equipment type not found.');
      if (prior.version !== body.version) return fail(409,'version_conflict','Equipment type changed.',{current:prior});
      const fields: Row = {};
      if (body.name !== undefined) fields.name=str(body.name,120);
      if (body.department !== undefined) fields.department=str(body.department,80);
      if (body.active !== undefined) fields.active=body.active===true?1:0;
      if (body.serial_expected !== undefined) fields.serial_expected=body.serial_expected===true?1:0;
      if (body.default_manufacturer !== undefined) fields.default_manufacturer=str(body.default_manufacturer)||null;
      const updated = {...prior,...fields,version:Number(prior.version)+1,updated_at:now()};
      if (!str(updated.name)) return fail(400,'validation','Name is required.');
      return save([sql(db,'UPDATE equipment_types SET name=?,department=?,active=?,serial_expected=?,default_manufacturer=?,version=?,updated_at=? WHERE equipment_type_id=? AND version=?',
        updated.name,updated.department,updated.active,updated.serial_expected,updated.default_manufacturer,updated.version,updated.updated_at,typeEdit[1],prior.version),
        event(db,me,'edit','equipment_type',typeEdit[1],prior,updated)],{item:updated});
    }
    if (path === '/api/customers' && method === 'GET') {
      const q=nameKey(url.searchParams.get('q')||'').slice(0,100);
      const items=await list(db,'SELECT * FROM customers WHERE active=1 AND (?=\'\' OR normalized_name LIKE ?) ORDER BY is_stock DESC,display_name LIMIT 35',
        q,q+'%');
      return reply({items});
    }
    if (path === '/api/customers' && method === 'POST') {
      if (!allowed(me,rights,'order_equipment')&&!allowed(me,rights,'receive_edit_equipment')) return fail(403,'forbidden','Order or receive permission required.');
      const name=str(body.display_name,200), norm=nameKey(name);
      if (!name) return fail(400,'validation','Customer name is required.');
      if (norm==='stock') return fail(400,'validation','Use the existing STOCK customer.');
      const similar=await list(db,'SELECT customer_id,display_name FROM customers WHERE active=1 AND (normalized_name=? OR similarity_key=?) LIMIT 10',norm,similarityKey(name));
      const value={customer_id:id('cus'),display_name:name,normalized_name:norm,similarity_key:similarityKey(name),created_by:me.email,created_at:now(),updated_at:now()};
      return save([insert(db,'customers',value),event(db,me,'create','equipment_customer',value.customer_id,{},value)],{customer:value,similar_customers:similar},201);
    }
    if (path === '/api/equipment/models' && method === 'GET') {
      const typeId=str(url.searchParams.get('type_id')), q=str(url.searchParams.get('q'),100);
      return reply({items:await list(db,`SELECT manufacturer,ordered_model AS model,COUNT(*) AS uses FROM equipment
        WHERE equipment_type_id=? AND (?='' OR ordered_model LIKE ?) GROUP BY manufacturer,ordered_model ORDER BY uses DESC,model LIMIT 20`,typeId,q,'%'+q+'%')});
    }
    if (path === '/api/equipment' && method === 'GET') {
      const limit=Math.min(Math.max(number(Number(url.searchParams.get('limit')||25)),1),100);
      const offset=Math.min(Math.max(number(Number(url.searchParams.get('offset')||0)),0),100000);
      const q=str(url.searchParams.get('q'),100), status=str(url.searchParams.get('status'),20),
        customer=str(url.searchParams.get('customer_id'),20), po=normalized(url.searchParams.get('po'));
      const items=await list(db,`SELECT e.*,c.display_name AS customer_name,t.name AS type_name,t.serial_expected
       FROM equipment e JOIN customers c ON c.customer_id=e.customer_id JOIN equipment_types t ON t.equipment_type_id=e.equipment_type_id
       WHERE (?='' OR e.status=?) AND (?='' OR e.customer_id=?) AND (?='' OR e.po_normalized=?)
       AND (?='' OR e.equipment_id LIKE ? OR e.ordered_model LIKE ? OR e.serial_number LIKE ? OR c.display_name LIKE ?)
       ORDER BY e.created_at DESC,e.equipment_id DESC LIMIT ? OFFSET ?`,
       status,status,customer,customer,po,po,q,q+'%',q+'%',q+'%',q+'%',limit,offset);
      return reply({items,limit,offset,next_offset:items.length===limit?offset+limit:null});
    }
    if (path === '/api/equipment/reviews' && method === 'GET') {
      if (!allowed(me,rights,'receive_edit_equipment')) return fail(403,'forbidden','Receive/edit permission required.');
      const state=str(url.searchParams.get('state')||'open',20);
      return reply({items:await list(db,'SELECT * FROM warehouse_review_items WHERE state=? ORDER BY created_at DESC LIMIT 100',state)});
    }
    const getBatch=path.match(/^\/api\/equipment\/batches\/(ebt-[a-z0-9]{8})$/);
    if (getBatch && method==='GET') {
      const batch=await one(db,'SELECT * FROM equipment_entry_batches WHERE entry_batch_id=?',getBatch[1]);
      if (!batch) return fail(404,'not_found','Batch not found.');
      const units=await list(db,'SELECT * FROM equipment WHERE entry_batch_id=? ORDER BY entry_line_id,unit_index',getBatch[1]);
      return reply({batch,units,received:units.filter(u=>u.received_at).length,total:units.length});
    }
    const getEquipment=path.match(/^\/api\/equipment\/(eqp-[a-z0-9]{8})$/);
    if (getEquipment && method==='GET') {
      const unit=await getUnit(db,getEquipment[1]);
      if (!unit) return fail(404,'not_found','Equipment not found.');
      const peers=unit.entry_batch_id?await list(db,'SELECT equipment_id,status,received_at,unit_index FROM equipment WHERE entry_batch_id=? ORDER BY entry_line_id,unit_index',unit.entry_batch_id):[];
      const prints=await list(db,'SELECT * FROM equipment_label_prints WHERE equipment_id=? ORDER BY prepared_at DESC LIMIT 10',unit.equipment_id);
      return reply({unit:unitView(unit),peers,progress:{received:peers.filter(p=>p.received_at).length,total:peers.length},prints});
    }
    if (path === '/api/equipment/orders' && method === 'POST') {
      if (!allowed(me,rights,'order_equipment')) return fail(403,'forbidden','Order equipment permission required.');
      const head=asObj(body.header), lines=Array.isArray(body.lines)?body.lines.map(asObj):[];
      const customerId=str(head.customer_id), customer=await one(db,'SELECT customer_id FROM customers WHERE customer_id=? AND active=1',customerId);
      if (!customer) return fail(400,'validation','Select a valid customer.');
      if (!lines.length||lines.length>25) return fail(400,'validation','Include 1 to 25 lines.');
      const total=lines.reduce((n,l)=>n+number(l.quantity??1),0);
      if(total<1||total>25||lines.some(l=>number(l.quantity??1)<1)) return fail(400,'validation','Order contains at most 25 individual units.');
      const typeRows=await list(db,'SELECT equipment_type_id FROM equipment_types WHERE active=1');
      const known=new Set(typeRows.map(x=>x.equipment_type_id));
      if(lines.some(l=>!known.has(str(l.equipment_type_id)))) return fail(400,'validation','Choose a valid active equipment type.');
      const timestamp=now(),batchId=id('ebt'),po=str(head.po_number,120),poNormalized=normalized(po);
      const batch={entry_batch_id:batchId,customer_id:customerId,po_number:po,po_normalized:poNormalized,
        requested_by_name:str(head.requested_by_name,150)||me.name,requested_by_email:str(head.requested_by_email,250)||null,
        expected_date:str(head.expected_date,10)||null,vendor:str(head.vendor,150),notes:str(head.notes,1000),
        entered_by_email:me.email,created_at:timestamp};
      if(batch.expected_date&&!/^\d{4}-\d{2}-\d{2}$/.test(batch.expected_date)) return fail(400,'validation','Expected date must use YYYY-MM-DD.');
      const statements=[insert(db,'equipment_entry_batches',batch)],unitIds:string[]=[];
      for(let i=0;i<lines.length;i++){
        const line=lines[i],lineId=id('ebl'),quantity=number(line.quantity??1);
        const manufacturer=str(line.manufacturer,150),model=str(line.model,200),vendor=str(line.vendor,150)||batch.vendor;
        statements.push(insert(db,'equipment_batch_lines',{entry_line_id:lineId,entry_batch_id:batchId,line_no:i+1,
          equipment_type_id:line.equipment_type_id,manufacturer,model,vendor,ordered_qty:quantity}));
        for(let j=1;j<=quantity;j++){
          const equipmentId=id('eqp');unitIds.push(equipmentId);
          statements.push(insert(db,'equipment',{equipment_id:equipmentId,entry_batch_id:batchId,entry_line_id:lineId,
           unit_index:j,source:'ordered',equipment_type_id:line.equipment_type_id,customer_id:customerId,po_number:po,
           po_normalized:poNormalized,requested_by_name:batch.requested_by_name,requested_by_email:batch.requested_by_email,
           expected_date:batch.expected_date,vendor,notes:batch.notes,manufacturer,manufacturer_normalized:normalized(manufacturer),
           ordered_model:model,status:'ordered',entered_by_email:me.email,created_at:timestamp,updated_at:timestamp,updated_by_email:me.email}));
        }
      }
      statements.push(event(db,me,'create','equipment_batch',batchId,{}, {batch_id:batchId,unit_ids:unitIds}));
      return save(statements,{batch_id:batchId,unit_ids:unitIds},201);
    }
    const unitUpdate=path.match(/^\/api\/equipment\/(eqp-[a-z0-9]{8})(?:\/(receive|cancel))?$/);
    if(unitUpdate && (method==='PATCH'||method==='POST')) {
      const unitId=unitUpdate[1],action=unitUpdate[2]||'edit',prior=await getUnit(db,unitId);
      if(!prior)return fail(404,'not_found','Equipment not found.');
      const receiver=allowed(me,rights,'receive_edit_equipment'),owner=allowed(me,rights,'order_equipment')&&prior.entered_by_email===me.email&&prior.status==='ordered';
      if(action==='receive'?!receiver:!(receiver||owner))return fail(403,'forbidden','Equipment edit permission required.');
      if(body.version!==prior.version)return fail(409,'version_conflict','Equipment changed. Review and retry.',{current:prior});
      if(action==='receive'&&prior.status!=='ordered')return fail(409,'status_conflict','Only ordered units can be received.');
      if(action==='cancel'&&prior.status!=='ordered')return fail(409,'status_conflict','Only ordered units can be cancelled here.');
      const changes=action==='edit'?asObj(body.changes):body;
      const allowedFields=action==='receive'
        ?['serial_number','confirmed_model','zone_id','floor_area_shelf_id','location_note']
        :action==='cancel'?[]
        :receiver?['customer_id','po_number','requested_by_name','expected_date','vendor','notes','manufacturer','ordered_model','confirmed_model','serial_number','zone_id','floor_area_shelf_id','location_note','status']
         :['customer_id','po_number','requested_by_name','expected_date','vendor','notes','manufacturer','ordered_model'];
      if(Object.keys(changes).some(k=>k!=='version'&&!allowedFields.includes(k)))return fail(400,'validation','Unsupported or unauthorized field.');
      const patch:Row={};
      for(const f of allowedFields)if(changes[f]!==undefined)patch[f]=['zone_id','floor_area_shelf_id','customer_id'].includes(f)?str(changes[f])||null:str(changes[f],f==='notes'?1000:250)||null;
      if(patch.po_number!==undefined)patch.po_normalized=normalized(patch.po_number);
      if(patch.manufacturer!==undefined)patch.manufacturer_normalized=normalized(patch.manufacturer);
      if(patch.serial_number!==undefined)patch.serial_normalized=normalized(patch.serial_number)||null;
      if(action==='receive'){patch.status='received';patch.received_at=now();patch.received_by_email=me.email;}
      if(action==='cancel'){patch.status='cancelled';patch.cancelled_at=now();patch.cancelled_by_email=me.email;}
      if(patch.status!==undefined && !['ordered','received','in_stock','reserved','installed','delivered','cancelled','returned'].includes(String(patch.status)))return fail(400,'validation','Invalid equipment status.');
      if(patch.zone_id) {
        const zone=await one(db,'SELECT zone_id FROM zones WHERE zone_id=? AND active=1',patch.zone_id);
        if(!zone)return fail(400,'validation','Location zone does not exist.');
      }
      const newArea=patch.floor_area_shelf_id??prior.floor_area_shelf_id,newZone=patch.zone_id??prior.zone_id;
      if(newArea){
        const area=await one(db,'SELECT shelf_id FROM shelves WHERE shelf_id=? AND kind=\'floor_area\' AND zone_id=? AND active=1',newArea,newZone);
        if(!area)return fail(400,'validation','Equipment location must be an active floor-area shelf within its zone.');
      }
      const changed={...prior,...patch,version:Number(prior.version)+1,updated_at:now(),updated_by_email:me.email};
      const columns=Object.keys(patch).concat(['version','updated_at','updated_by_email']);
      const st=[sql(db,`UPDATE equipment SET ${columns.map(c=>c+'=?').join(',')} WHERE equipment_id=? AND version=?`,
        ...columns.map(c=>changed[c]),unitId,prior.version),event(db,me,action,'equipment',unitId,prior,changed)];
      if(action==='receive'){
        if(str(changed.confirmed_model)&&normalized(changed.confirmed_model)!==normalized(changed.ordered_model)) st.push(review(db,me,unitId,'MODEL_MISMATCH',{ordered_model:prior.ordered_model,confirmed_model:changed.confirmed_model}));
        if(changed.serial_normalized){
          const dupes=await list(db,'SELECT equipment_id FROM equipment WHERE equipment_id<>? AND serial_normalized=? AND manufacturer_normalized=? LIMIT 5',unitId,changed.serial_normalized,changed.manufacturer_normalized);
          if(dupes.length)st.push(review(db,me,unitId,'DUPLICATE_SERIAL',{matches:dupes.map(d=>d.equipment_id)}));
        }
      }
      return save(st,{unit:changed});
    }
    const batchAction=path.match(/^\/api\/equipment\/batches\/(ebt-[a-z0-9]{8})\/(cancel|receive)$/);
    if(batchAction&&method==='POST'){
      const batch=await one(db,'SELECT * FROM equipment_entry_batches WHERE entry_batch_id=?',batchAction[1]);
      if(!batch)return fail(404,'not_found','Batch not found.');
      const isReceive=batchAction[2]==='receive';
      const receiver=allowed(me,rights,'receive_edit_equipment');
      if(isReceive?!receiver:!(receiver||(allowed(me,rights,'order_equipment')&&batch.entered_by_email===me.email)))
        return fail(403,'forbidden','Permission required.');
      const units=await list(db,'SELECT * FROM equipment WHERE entry_batch_id=? AND status=\'ordered\' ORDER BY equipment_id',batchAction[1]);
      const statements:ReturnType<D1['prepare']>[]=[];
      for(const unit of units){
        const changes=isReceive?{status:'received',received_at:now(),received_by_email:me.email}:{status:'cancelled',cancelled_at:now(),cancelled_by_email:me.email};
        statements.push(sql(db,`UPDATE equipment SET ${Object.keys(changes).map(k=>k+'=?').join(',')},version=version+1,updated_at=?,updated_by_email=? WHERE equipment_id=? AND version=?`,
          ...Object.values(changes),now(),me.email,unit.equipment_id,unit.version));
      }
      if(!units.length)return fail(409,'status_conflict','No ordered units remain.');
      statements.push(event(db,me,isReceive?'receive_batch':'cancel_batch','equipment_batch',batchAction[1],{}, {unit_ids:units.map(u=>u.equipment_id)}));
      return save(statements,{unit_ids:units.map(u=>u.equipment_id),affected:units.length});
    }
    if(path==='/api/equipment/receive-unregistered'&&method==='POST'){
      if(!allowed(me,rights,'receive_edit_equipment'))return fail(403,'forbidden','Receive permission required.');
      const customer=await one(db,'SELECT customer_id FROM customers WHERE customer_id=? AND active=1',str(body.customer_id));
      const type=await one(db,'SELECT equipment_type_id FROM equipment_types WHERE equipment_type_id=? AND active=1',str(body.equipment_type_id));
      if(!customer||!type)return fail(400,'validation','Valid customer and equipment type required.');
      const equipmentId=id('eqp'),timestamp=now(),serial=str(body.serial_number,250)||null,manufacturer=str(body.manufacturer,150);
      const unit={equipment_id:equipmentId,source:'unregistered_receipt',equipment_type_id:body.equipment_type_id,customer_id:body.customer_id,
        po_number:str(body.po_number,120),po_normalized:normalized(body.po_number),requested_by_name:str(body.requested_by_name),
        manufacturer,manufacturer_normalized:normalized(manufacturer),ordered_model:str(body.model,200),confirmed_model:str(body.model,200),
        serial_number:serial,serial_normalized:normalized(serial)||null,status:'received',received_at:timestamp,received_by_email:me.email,
        entered_by_email:me.email,created_at:timestamp,updated_at:timestamp,updated_by_email:me.email};
      return save([insert(db,'equipment',unit),review(db,me,equipmentId,'UNREGISTERED_RECEIPT',{}),
       event(db,me,'receive_unregistered','equipment',equipmentId,{},unit)],{unit},201);
    }
    if(path==='/api/equipment/labels/prepare'&&method==='POST'){
      const ids=Array.isArray(body.equipment_ids)?body.equipment_ids.map(x=>str(x)):[],skip=number(body.skip_first_positions??0);
      if(!ids.length||ids.length>100||new Set(ids).size!==ids.length||skip<0||skip>7)return fail(400,'validation','Select 1–100 unique equipment units and skip 0–7 positions.');
      const found=await list(db,`SELECT e.*,c.display_name AS customer_name,c.is_stock,t.name AS type_name,l.ordered_qty FROM equipment e
        JOIN customers c ON c.customer_id=e.customer_id JOIN equipment_types t ON t.equipment_type_id=e.equipment_type_id
        LEFT JOIN equipment_batch_lines l ON l.entry_line_id=e.entry_line_id
        WHERE e.equipment_id IN (SELECT value FROM json_each(?))`,JSON.stringify(ids));
      if(found.length!==ids.length)return fail(404,'not_found','Some equipment IDs do not exist.');
      if(found.some(r=>!allowed(me,rights,'print_labels')&&!allowed(me,rights,'receive_edit_equipment')&&!(allowed(me,rights,'order_equipment')&&r.entered_by_email===me.email)))
        return fail(403,'forbidden','Print permission required.');
      const sorted=found.sort((a,b)=>Number(b.is_stock)-Number(a.is_stock)||String(a.customer_name).localeCompare(String(b.customer_name))||String(a.po_number).localeCompare(String(b.po_number))||Number(a.unit_index)-Number(b.unit_index));
      const runId=crypto.randomUUID(),statements:ReturnType<D1['prepare']>[]=[],labels:Row[]=[];
      sorted.forEach((unit,i)=>{
        const snapshot=labelRecord(unit),printId=id('elp'),position=i+skip,page=Math.floor(position/8)+1;
        statements.push(insert(db,'equipment_label_prints',{label_print_id:printId,equipment_id:unit.equipment_id,
          entry_batch_id:unit.entry_batch_id??null,sheet_run_id:runId,page_number:page,sheet_position:(position%8)+1,
          printed_snapshot_json:JSON.stringify(snapshot),label_fingerprint:labelFingerprint(snapshot),
          prepared_at:now(),prepared_by_email:me.email}));
        labels.push({...snapshot,label_print_id:printId,page_number:page,sheet_position:(position%8)+1});
      });
      return save(statements,{run_id:runId,labels,skip_first_positions:skip});
    }
    if(path==='/api/equipment/labels/confirm'&&method==='POST'){
      const ids=Array.isArray(body.prepared_print_ids)?body.prepared_print_ids.map(x=>str(x)):[];
      if(!ids.length||ids.length>100||new Set(ids).size!==ids.length)return fail(400,'validation','Provide valid label print IDs.');
      const prints=await list(db,'SELECT p.*,e.entered_by_email FROM equipment_label_prints p JOIN equipment e ON e.equipment_id=p.equipment_id WHERE p.label_print_id IN (SELECT value FROM json_each(?))',JSON.stringify(ids));
      if(prints.length!==ids.length||prints.some(p=>p.confirmed_printed_at))return fail(409,'status_conflict','Unknown or already confirmed label print.');
      if(prints.some(p=>!allowed(me,rights,'print_labels')&&!allowed(me,rights,'receive_edit_equipment')&&!(allowed(me,rights,'order_equipment')&&p.entered_by_email===me.email)))return fail(403,'forbidden','Print permission required.');
      const stamp=now();
      const statements=prints.map(p=>sql(db,'UPDATE equipment_label_prints SET confirmed_printed_at=?,confirmed_by_email=? WHERE label_print_id=? AND confirmed_printed_at IS NULL',stamp,me.email,p.label_print_id));
      statements.push(event(db,me,'confirm_print','equipment_label',str(prints[0].sheet_run_id),{}, {print_ids:ids}));
      return save(statements,{confirmed:ids.length});
    }
    const reviewAction=path.match(/^\/api\/equipment\/reviews\/(rev-[a-z0-9]{8})$/);
    if(reviewAction&&method==='PATCH'){
      if(!allowed(me,rights,'receive_edit_equipment'))return fail(403,'forbidden','Receive permission required.');
      const prior=await one(db,'SELECT * FROM warehouse_review_items WHERE review_id=?',reviewAction[1]);
      if(!prior)return fail(404,'not_found','Review item not found.');
      if(body.version!==prior.version)return fail(409,'version_conflict','Review item changed.',{current:prior});
      if(!['resolved','dismissed'].includes(str(body.state)))return fail(400,'validation','Choose resolved or dismissed.');
      return save([sql(db,'UPDATE warehouse_review_items SET state=?,resolved_at=?,resolved_by=?,version=version+1 WHERE review_id=? AND version=?',body.state,now(),me.email,reviewAction[1],prior.version),
        event(db,me,'resolve_review','equipment_review',reviewAction[1],prior,{...prior,state:body.state})],{review_id:reviewAction[1],state:body.state});
    }
    if(path==='/api/staff'&&method==='GET'){
      if(!allowed(me,rights,'manage_staff'))return fail(403,'forbidden','Staff permission required.');
      return reply({items:await list(db,'SELECT s.email,s.display_name,s.active,p.permission FROM staff_accounts s LEFT JOIN staff_permissions p ON s.email=p.email ORDER BY s.email')});
    }
    const grant=path.match(/^\/api\/staff\/([^/]+)\/permissions\/([a-z_]+)$/);
    if(grant&&(method==='PUT'||method==='DELETE')){
      if(!allowed(me,rights,'manage_staff')||(grant[2]==='admin'&&me.role!=='admin'))return fail(403,'forbidden','Staff permission required.');
      const email=decodeURIComponent(grant[1]).toLowerCase(),permission=grant[2];
      if(!['order_equipment','receive_edit_equipment','print_labels','manage_equipment_types','edit_parts_stock','edit_layout','manage_packouts','manage_employees','manage_zones','manage_staff','admin'].includes(permission))
        return fail(400,'validation','Unrecognized permission.');
      if(!/^[^\s@]+@[^\s@]+$/.test(email))return fail(400,'validation','Invalid email.');
      const statements=method==='PUT'?[
        sql(db,'INSERT OR IGNORE INTO staff_accounts(email,display_name,created_at,updated_at) VALUES(?,?,?,?)',email,email,now(),now()),
        sql(db,'INSERT OR IGNORE INTO staff_permissions(email,permission,granted_by_email,granted_at) VALUES(?,?,?,?)',email,permission,me.email,now())
      ]:[sql(db,'DELETE FROM staff_permissions WHERE email=? AND permission=?',email,permission)];
      statements.push(event(db,me,method==='PUT'?'grant':'revoke','staff_permission',email+'|'+permission,{}, {email,permission}));
      return save(statements,{email,permission,granted:method==='PUT'});
    }
    return fail(404,'not_found','Unknown equipment endpoint.');
  } catch (error) {
    if(error instanceof SyntaxError)return fail(400,'validation','Invalid JSON.');
    if(String(error).includes('UNIQUE constraint failed: idempotency_requests.'))return fail(409,'idempotency_conflict','An identical request is already being processed. Retry with the same key.');
    if(String(error).includes('warehouse_meta.revision')||String(error).includes('NOT NULL constraint failed: warehouse_meta.revision'))
      return fail(409,'version_conflict','Warehouse changed during this request. Retry with the current version.');
    console.error('equipment request failed', {path,category:'database_or_validation'});
    return fail(503,'database_unavailable','Equipment request failed; verify the equipment migration and retry.');
  }
}
