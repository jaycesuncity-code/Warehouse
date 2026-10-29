import { api } from '../shared/api';
import { isPartId } from '../shared/ids';
import type { Part } from '../shared/contract';
import generatorSource from '../../labels/bin-label-generator.html?raw';

type Staged = { k: number; id: string; idSrc: string; name: string; code: string; qty: string; ex: Record<string,string>; keepInvalid: boolean; iss: unknown[] };
type GeneratorWindow = Window & { __BLG?: { rows: Staged[] }; __lastPdfBlob?: Blob; XLSX?: any };
const frame = document.querySelector<HTMLIFrameElement>('#generator')!;
const list = document.querySelector<HTMLDivElement>('#selection')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const searchResults = document.querySelector<HTMLDivElement>('#searchResults')!;
let selected = new Map<number,boolean>();
let serverStatus = new Map<number,string>();
let active = false;
let matched: Part[] = [];
const norm = (s: string) => s.trim().toLowerCase();
const alertMessage = (message: string, error = false) => {
  status.textContent = message;
  status.setAttribute('data-error', String(error));
};
const child = (): GeneratorWindow => {
  const w = frame.contentWindow as GeneratorWindow | null;
  if (!w?.__BLG) throw Error('Generator is not ready.');
  return w;
};
const parts = () => child().__BLG!.rows;
const chosen = () => parts().filter(r => selected.get(r.k) !== false);
function renderSelection() {
  let rows: Staged[];
  try { rows = parts(); } catch { return; }
  const seen = new Set(rows.map(r => r.k));
  for (const k of selected.keys()) if (!seen.has(k)) selected.delete(k);
  list.replaceChildren();
  const heading = document.createElement('p');
  heading.textContent = rows.length + ' staged part(s), ' + rows.filter(r => selected.get(r.k) !== false).length + ' selected for registration / printing';
  list.append(heading);
  for (const r of rows) {
    const line = document.createElement('label'); line.className = 'part-row';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = selected.get(r.k) !== false;
    chk.addEventListener('change', () => { selected.set(r.k, chk.checked); renderSelection(); });
    const text = document.createElement('span');
    text.textContent = (r.code || 'MISSING SKU') + ' · ' + (r.name || 'MISSING NAME') + (r.id ? ' · '+r.id : '');
    const badge = document.createElement('small'); badge.textContent = serverStatus.get(r.k) || '';
    line.append(chk,text,badge); list.append(line);
  }
  (document.querySelector('#generate') as HTMLButtonElement).disabled = active || chosen().length === 0;
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function resolve(list: Staged[]) {
  const identity = await api.me();
  const pending: Staged[] = [];
  let failed = 0;
  // Check duplicate SKUs without silently merging rows or altering stock.
  const seen = new Set<string>();
  for (const r of list) {
    const key = norm(r.code);
    if (!key || !r.name.trim()) { serverStatus.set(r.k,'Both SKU and name required'); failed++; continue; }
    if (seen.has(key)) { serverStatus.set(r.k,'Duplicate SKU in selected list'); failed++; continue; }
    seen.add(key);
    if (r.id) {
      if (!isPartId(r.id)) { serverStatus.set(r.k,'Invalid imported ID — clear it in the editor'); failed++; continue; }
      try {
        const p = await api.getPart(r.id);
        if (norm(p.part_code) !== key || norm(p.part_name) !== norm(r.name)) {
          serverStatus.set(r.k,'ID conflicts with database SKU/name — clear ID in editor'); failed++; continue;
        }
        r.id = p.part_id; r.idSrc = 'reused'; serverStatus.set(r.k,'Existing ID verified');
      } catch {
        serverStatus.set(r.k,'Imported ID not in database — clear ID in editor'); failed++;
      }
    } else if (identity.role === 'viewer') {
      const found = await api.searchParts({q:r.code,limit:100});
      const p = found.items.find(p => norm(p.part_code)===key && norm(p.part_name)===norm(r.name));
      if (!p) { serverStatus.set(r.k,'Viewer may only reprint existing parts'); failed++; }
      else { r.id=p.part_id; r.idSrc='reused'; serverStatus.set(r.k,'Existing part matched'); }
    } else pending.push(r);
  }
  if (pending.length) {
    // Only selected unresolved rows are sent. Server is authoritative and enforces editor role.
    const response = await api.registerParts({rows:pending.map(r=>({part_code:r.code.trim(),part_name:r.name.trim()}))});
    const reported = new Set<number>();
    for (const outcome of response.results) {
      const r = pending[outcome.index]; if (!r) continue;
      reported.add(outcome.index);
      if (outcome.status === 'conflict' || !isPartId(outcome.part_id)) {
        serverStatus.set(r.k, outcome.message || 'Database conflict'); failed++;
      } else {
        r.id = outcome.part_id; r.idSrc = outcome.status === 'new' ? 'new' : 'reused';
        serverStatus.set(r.k, outcome.status === 'new' ? 'Registered' : 'Reused existing');
      }
    }
    for (let i=0;i<pending.length;i++) if (!reported.has(i)) { serverStatus.set(pending[i].k,'No result from server'); failed++; }
  }
  // Read back every ID, including partial successes, before producing any QR.
  for (const r of list) {
    if (!isPartId(r.id)) continue;
    try {
      const p = await api.getPart(r.id);
      if (norm(p.part_code)!==norm(r.code) || norm(p.part_name)!==norm(r.name)) {
        serverStatus.set(r.k,'Read-back ID mismatch'); failed++;
      }
    } catch { serverStatus.set(r.k,'Read-back lookup failed'); failed++; }
  }
  if (failed) throw Error(failed + ' row issue(s). Successful registrations were kept; fix conflicts and retry.');
  if (list.some(r=>!isPartId(r.id))) throw Error('Unverified IDs. No PDF generated.');
}
/** Uses unchanged vector-PDF renderer and all its physical print settings. */
async function printSelected(selection: Staged[]) {
  const w = child(), arr = parts();
  const original = arr.slice();
  const button = w.document.querySelector<HTMLButtonElement>('#btnGen')!;
  const old = w.__lastPdfBlob;
  arr.splice(0,arr.length,...selection);
  // Source generator must have all canonical IDs; it cannot mint any new one here.
  if (arr.some(r=>!isPartId(r.id))) { arr.splice(0,arr.length,...original); throw Error('Unsafe QR payload prevented'); }
  let completed = false;
  try {
    button.click();
    const blob = await new Promise<Blob>((resolve,reject)=>{
      const started = Date.now();
      const timer = setInterval(()=>{
        if (w.__lastPdfBlob && w.__lastPdfBlob !== old) { clearInterval(timer); resolve(w.__lastPdfBlob); }
        else if (w.document.querySelector('#progTxt')?.textContent === 'Failed.' || Date.now()-started > 120000) {
          clearInterval(timer); reject(Error('PDF generation failed or timed out'));
        }
      },150);
    });
    completed = true;
    alertMessage(selection.length + ' confirmed label(s) generated. Print at 100% / Actual size. No stock adjusted.');
    return blob;
  } finally {
    arr.splice(0,arr.length,...original);
    // Refresh the original editor without changing its saved label dimensions.
    const settings = w.document.querySelector<HTMLSelectElement>('#s_rows');
    settings?.dispatchEvent(new Event('change',{bubbles:true}));
    renderSelection();
    if (!completed) alertMessage('PDF was not generated. The staged list is intact.',true);
  }
}
async function generate() {
  if (active) return;
  const selection = chosen();
  if (!selection.length) { alertMessage('Select parts first.',true); return; }
  active = true; frame.style.pointerEvents='none'; renderSelection();
  try {
    alertMessage('Resolving selected parts against warehouse database...');
    await resolve(selection);
    renderSelection();
    const pdf = await printSelected(selection);
    (document.querySelector('#download') as HTMLButtonElement).onclick = () => saveBlob(pdf,'sun-city-bin-labels.pdf');
    (document.querySelector('#download') as HTMLButtonElement).disabled=false;
    (document.querySelector('#csv') as HTMLButtonElement).disabled=false;
    (document.querySelector('#xlsx') as HTMLButtonElement).disabled=false;
  } catch(e) { alertMessage(e instanceof Error ? e.message : 'Could not generate labels.',true); renderSelection(); }
  finally { active=false; frame.style.pointerEvents='auto'; renderSelection(); }
}
function exportRows(xlsx: boolean) {
  const selectedRows=chosen().filter(r=>isPartId(r.id));
  if (!selectedRows.length) return;
  const cols=Array.from(new Set(selectedRows.flatMap(r=>Object.keys(r.ex||{}))));
  const matrix=[['part_id','part_name','part_code','expected_qty',...cols],...selectedRows.map(r=>[r.id,r.name,r.code,r.qty,...cols.map(c=>r.ex[c]||'')])];
  if (xlsx) {
    const X=child().XLSX; if (!X) throw Error('Spreadsheet library not ready');
    const book=X.utils.book_new(); X.utils.book_append_sheet(book,X.utils.aoa_to_sheet(matrix),'Resolved parts');
    const binary=X.write(book,{bookType:'xlsx',type:'array'});
    saveBlob(new Blob([binary],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'resolved-parts.xlsx');
  } else {
    const csv=matrix.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    saveBlob(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),'resolved-parts.csv');
  }
}
document.querySelector('#generate')!.addEventListener('click',()=>void generate());
document.querySelector('#csv')!.addEventListener('click',()=>exportRows(false));
document.querySelector('#xlsx')!.addEventListener('click',()=>exportRows(true));
document.querySelector('#all')!.addEventListener('click',()=>{for(const r of parts())selected.set(r.k,true);renderSelection();});
document.querySelector('#none')!.addEventListener('click',()=>{for(const r of parts())selected.set(r.k,false);renderSelection();});
document.querySelector('#refresh')!.addEventListener('click',renderSelection);
document.querySelector('#find')!.addEventListener('click',async()=>{
  const q=(document.querySelector('#query') as HTMLInputElement).value.trim();
  if (!q) return;
  searchResults.textContent='Searching...';
  try {
    matched=(await api.searchParts({q,limit:50})).items;
    searchResults.replaceChildren();
    for (const p of matched) {
      const btn=document.createElement('button');btn.textContent=p.part_code+' · '+p.part_name;btn.className='match';
      btn.addEventListener('click',()=>{
        const arr=parts();
        const key=-Math.floor(performance.now()*100000+Math.random()*10000);
        arr.push({k:key,id:p.part_id,idSrc:'reused',name:p.part_name,code:p.part_code,qty:'',ex:{},keepInvalid:false,iss:[]});
        selected.set(key,true);serverStatus.set(key,'Existing part added');renderSelection();
      });
      searchResults.append(btn);
    }
    if (!matched.length)searchResults.textContent='No existing parts found.';
  } catch(e){searchResults.textContent='Search failed: '+String(e);}
});
frame.onload=()=>{
  try {
    const w=child(), doc=w.document;
    // Never offer stale exports after edits, additions, or selection changes.
    const invalidate = () => {
      for (const id of ['download','csv','xlsx']) (document.querySelector('#'+id) as HTMLButtonElement).disabled = true;
    };
    doc.addEventListener('input', invalidate, true);
    doc.addEventListener('change', invalidate, true);
    doc.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('button') && !target.closest('#btnTest')) invalidate();
    }, true);
    for (const id of ['all','none','refresh']) document.querySelector('#'+id)!.addEventListener('click',invalidate);
    const style=doc.createElement('style');
    style.textContent='#btnGen,#btnDlCsv,#btnDlXlsx,#bulkInvalid,button[data-act=newid],button[data-act=keep],button[data-act=replace],#exportWhy,#stale{display:none!important}';
    doc.head.append(style);
    const grid=doc.querySelector('#grid');
    if (grid) new MutationObserver(()=>renderSelection()).observe(grid,{childList:true,subtree:true});
    renderSelection(); alertMessage('Add parts in the editor below, then select and resolve them here.');
  } catch(e){ alertMessage('Generator failed to load: '+String(e),true); }
};
frame.srcdoc=generatorSource;
