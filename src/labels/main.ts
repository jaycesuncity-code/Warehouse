import { integratedRenderer } from './renderer';
import { MODE } from '../shared/config';
import { api } from '../shared/api';
import { isPartId } from '../shared/ids';
import type { Part } from '../shared/contract';
import generatorSource from '../../labels/bin-label-generator.html?raw';

type Staged = { k: number; id: string; idSrc: string; name: string; code: string; qty: string; ex: Record<string,string>; keepInvalid: boolean; iss: unknown[] };
type SheetAPI = {utils:{book_new:()=>unknown;book_append_sheet:(book:unknown,sheet:unknown,name:string)=>void;aoa_to_sheet:(rows:string[][])=>unknown};write:(book:unknown,options:{bookType:string;type:string})=>ArrayBuffer};
type GeneratorWindow = Window & { __BLG?: { rows: Staged[]; S: Record<string,unknown>; refresh:()=>void; invalidate:()=>void; renderConfirmed:(rows:Staged[])=>Promise<Blob> }; XLSX?: SheetAPI };
const frame = document.querySelector<HTMLIFrameElement>('#generator')!;
const list = document.querySelector<HTMLDivElement>('#selection')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const searchResults = document.querySelector<HTMLDivElement>('#searchResults')!;
const selected = new Map<number,boolean>();
const serverStatus = new Map<number,string>();
let active = false;
let output: {rows:Staged[]; fingerprint:string} | null = null;
const fingerprint = () => JSON.stringify({rows:chosen(),settings:child().__BLG!.S});
function invalidateOutput() {
 output=null;
 for(const id of ['download','csv','xlsx']) (document.querySelector('#'+id) as HTMLButtonElement).disabled=true;
 try {child().__BLG!.invalidate();} catch { /* frame not ready */ }
}
function checkOutput() { if(!output || output.fingerprint!==fingerprint()) {invalidateOutput();return false;} return true; }

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
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = selected.get(r.k) !== false; chk.disabled=active;
    chk.addEventListener('change', () => { selected.set(r.k, chk.checked); invalidateOutput(); renderSelection(); });
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
/** Render an immutable selected snapshot; the editor array is never replaced. */
async function printSelected(selection: Staged[]) {
 return child().__BLG!.renderConfirmed(structuredClone(selection));
}
async function generate() {
  if (active) return;
  const selection = chosen();
  if (!selection.length) { alertMessage('Select parts first.',true); return; }
  invalidateOutput(); active = true; frame.inert=true; document.querySelectorAll<HTMLButtonElement>('main button').forEach(b=>b.disabled=true); renderSelection();
  try {
    alertMessage('Resolving selected parts against warehouse database...');
    await resolve(selection);
    renderSelection();
    const snapshot=structuredClone(selection);
    const expected=fingerprint();
    const pdf = await printSelected(snapshot);
    if(expected!==fingerprint())throw Error('The list changed during generation. Generate again.');
    output={rows:snapshot,fingerprint:expected};
    (document.querySelector('#download') as HTMLButtonElement).onclick = () => {if(checkOutput())saveBlob(pdf,'sun-city-bin-labels.pdf');};
    (document.querySelector('#download') as HTMLButtonElement).disabled=false;
    (document.querySelector('#csv') as HTMLButtonElement).disabled=false;
    (document.querySelector('#xlsx') as HTMLButtonElement).disabled=false;
  } catch(e) { alertMessage(e instanceof Error ? e.message : 'Could not generate labels.',true); renderSelection(); }
  finally { active=false; frame.inert=false; document.querySelectorAll<HTMLButtonElement>('.match').forEach(b=>b.disabled=false); for(const id of ['find','all','none','refresh']) (document.querySelector('#'+id) as HTMLButtonElement).disabled=false; child().__BLG!.refresh(); renderSelection(); }
}
function exportRows(xlsx: boolean) {
  if(!checkOutput())return;
  const selectedRows=output!.rows;
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
        invalidateOutput();selected.set(key,true);serverStatus.set(key,'Existing part added');child().__BLG!.refresh();renderSelection();
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
    const invalidate = () => {if(!active) invalidateOutput();};
    doc.addEventListener('input', invalidate, true);
    doc.addEventListener('change', invalidate, true);
    doc.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('button') && !target.closest('#btnTest')) invalidate();
    }, true);
    for (const id of ['all','none','refresh']) document.querySelector('#'+id)!.addEventListener('click',invalidate);
    const style=doc.createElement('style');
    style.textContent='#bulkInvalid,button[data-act=newid],button[data-act=keep],#exportWhy,#stale{display:none!important}';
    doc.head.append(style);
    const grid=doc.querySelector('#grid');
    if (grid) new MutationObserver(()=>renderSelection()).observe(grid,{childList:true,subtree:true});
    renderSelection(); alertMessage('Add parts in the editor below, then select and resolve them here.');
  } catch(e){ alertMessage('Generator failed to load: '+String(e),true); }
};
window.addEventListener('warehouse-generate',()=>void generate());
const mode=document.createElement('p'); mode.textContent=MODE==='mock'?'DEMO DATA — changes stay in this browser':'Warehouse database'; document.querySelector('header')!.append(mode);
frame.srcdoc=integratedRenderer(generatorSource);
