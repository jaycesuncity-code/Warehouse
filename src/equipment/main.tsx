import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isEquipmentId } from '../shared/ids';
import { avery5821Pdf, type EquipmentLabel } from './pdf';
import { StaffPanel } from './StaffPanel';
import { EquipmentOrdersPanel } from './EquipmentOrdersPanel';
import { explicitLabelTargetIds, printableOrderEquipmentIds, printableInventoryEquipmentIds, hasUnconfirmedPrintJob } from './print-targets';
import { browserEquipmentStore, EquipmentApiError, createMutation, failureDisposition, performMutation, readPendingMutation, type MutationMethod, type PendingMutation } from './recoverable';
import '../shared/ui/styles.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
type Tab = 'orders'|'receive'|'inventory'|'reviews'|'labels'|'staff'|'customers';
const base = 'rounded-lg border border-gray-300 bg-white px-3 py-2 w-full text-gray-900';
const button = 'rounded-lg px-4 py-3 font-bold border border-[#6B1A2C] bg-[#6B1A2C] text-white disabled:opacity-50';
async function req(path:string,method='GET',body?:R,mutationKey?:string):Promise<R> {
 const response = await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json','Idempotency-Key':mutationKey??crypto.randomUUID()}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
 let parsed:R;
 try{parsed=await response.json();}catch{
  if(response.status===401||response.status===403)
   throw new EquipmentApiError(response.status,'forbidden','You are not authorized to complete this equipment request.');
  if(response.status>=400&&response.status<500&&response.status!==409&&response.status!==408)
   throw new EquipmentApiError(response.status,'request_rejected','Server rejected this equipment request (HTTP '+response.status+') with an invalid response body.');
  throw new Error('Server returned an invalid response. Check the warehouse deployment.');
 }
 if(!response.ok)throw new EquipmentApiError(response.status,text(parsed.error||'request_failed'),text(parsed.message||'Request failed ('+response.status+')'));
 return parsed;
}
const text = (value:unknown) => String(value??'');
const errorText = (e:unknown) => e instanceof Error?e.message:String(e);
// Preferences are optional; their storage failure must not misreport a saved order as failed.
function rememberEquipmentChoice(key:string,value:string){
 try{browserEquipmentStore.setItem(key,value);}catch{/* Nonessential preference. */}
}
function App(){
 const [tab,setTab]=useState<Tab>('orders'),[me,setMe]=useState<R|null>(null),[types,setTypes]=useState<R[]>([]),[customers,setCustomers]=useState<R[]>([]);
 const [units,setUnits]=useState<R[]>([]),[reviews,setReviews]=useState<R[]>([]),[zones,setZones]=useState<R[]>([]),[stats,setStats]=useState<R|null>(null),[reprints,setReprints]=useState<R[]>([]),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [q,setQ]=useState(''),[selected,setSelected]=useState<string[]>([]);
 // A print job has explicit targets; inventory selection and receiving are separate.
 const [printTargetIds,setPrintTargetIds]=useState<string[]>([]);
 const [preparedTargetIds,setPreparedTargetIds]=useState<string[]>([]);
 const [customerId,setCustomerId]=useState(browserEquipmentStore.getItem('equipment.customer')??'cus-stk22222'),[po,setPo]=useState('');
 const [unregisteredType,setUnregisteredType]=useState('');
 const [scan,setScan]=useState(new URLSearchParams(location.search).get('id')??''),[unit,setUnit]=useState<R|null>(null);
 const [serial,setSerial]=useState(''),[model,setModel]=useState(''),[locationNote,setLocationNote]=useState(''),[zoneId,setZoneId]=useState(''),[disposition,setDisposition]=useState('received'),[returnReason,setReturnReason]=useState(''),[returnDestination,setReturnDestination]=useState('warehouse');
 const [lastBatch,setLastBatch]=useState(''),[skip,setSkip]=useState(0),[printIds,setPrintIds]=useState<string[]>([]);
 const [lastPdf,setLastPdf]=useState<Blob|null>(null);
 const [busy,setBusy]=useState(false),writeLock=useRef(false);
 const [pendingMutation,setPendingMutation]=useState<PendingMutation|null>(()=>readPendingMutation(browserEquipmentStore));
 const [ordersRefreshVersion,setOrdersRefreshVersion]=useState(0);
 const [recoveredOrder,setRecoveredOrder]=useState<{batchId:string;sequence:number}|null>(null);
 const [batchSearch,setBatchSearch]=useState(''),[batches,setBatches]=useState<R[]>([]);
 const [batchData,setBatchData]=useState<R|null>(null),[batchOffset,setBatchOffset]=useState<number|null>(null);
 const [inventoryOffset,setInventoryOffset]=useState<number|null>(null);
 const inventoryRequest=useRef(0),batchRequest=useRef(0),unitRequest=useRef(0);
 const [correction,setCorrection]=useState<R>({});
 const [customerQuery,setCustomerQuery]=useState(''),[mergeCustomers,setMergeCustomers]=useState<R[]>([]);
 const [mergeFrom,setMergeFrom]=useState(''),[mergeInto,setMergeInto]=useState(''),[mergePreview,setMergePreview]=useState<R|null>(null);
 const rights=me?.permissions??[];
 const can=(p:string)=>rights.includes('admin')||rights.includes(p);
 function report(e:unknown){setError(errorText(e));setNotice('');}
 function success(message:string){setNotice(message);setError('');}
 function confirmDiscardUnconfirmedPrintJob(action:string):boolean {
  if(!hasUnconfirmedPrintJob(printIds))return true;
  return window.confirm('A prepared equipment label job ('+printIds.length+' label(s): '+preparedTargetIds.join(', ')+') has not been confirmed as physically printed. Discard that print job to '+action+'? You will lose the ability to confirm this job from the Labels screen.');
 }
 function choosePrint(ids:string[]){
  // A lost response to label preparation still owns its original idempotency
  // receipt. Never mix that pending job with a new selection before recovery.
  if(readPendingMutation(browserEquipmentStore)){
   report(new Error('Recover the pending equipment request before selecting another print job.'));
   return;
  }
  const targets=explicitLabelTargetIds(ids);
  if(!targets){report(new Error('Select 1 to 25 distinct, valid Equipment IDs before printing.'));return;}
  if(!confirmDiscardUnconfirmedPrintJob('start a different label selection'))return;
  setPrintTargetIds(targets);setLastPdf(null);setPrintIds([]);setPreparedTargetIds([]);setTab('labels');setError('');
 }
 function navigate(next:Tab){
  if(next!==tab){
   // Manually changing sections never inherits a previous order, scanner or
   // inventory draft. A prepared PDF and its receipt remain confirmable.
   setPrintTargetIds([]);setSelected([]);
  }
  setTab(next);setError('');
 }
 function downloadEquipmentPdf(result:R){
  const blob=avery5821Pdf(result.labels as EquipmentLabel[]);
  setLastPdf(blob);setPrintIds(result.labels.map((x:R)=>x.label_print_id));
  // The backend decides final print order. Display the exact IDs in the PDF.
  setPreparedTargetIds(result.labels.map((x:R)=>String(x.equipment_id)));
  const href=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=href;anchor.download='sun-city-equipment-avery-5821.pdf';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(href),20000);
 }
 async function mutate(kind:string,path:string,method:MutationMethod,body:R,recover?:PendingMutation):Promise<R>{
  if(writeLock.current)throw new Error('Another equipment save is in progress.');
  writeLock.current=true;setBusy(true);
  const attempt=recover??createMutation(kind,path,method,body);
  setPendingMutation(attempt);
  try{
   return await performMutation(browserEquipmentStore,attempt,async saved=>{
    const result=await req(saved.path,saved.method,saved.body,saved.key);
    if(saved.kind==='labels')downloadEquipmentPdf(result);
    return result;
   },!!recover);
  }catch(e){
   if(failureDisposition(e)==='uncertain')
    throw new Error(errorText(e)+' Result uncertain: recover the original request, not a new submission.', { cause: e });
   if(e instanceof EquipmentApiError&&e.status===409&&e.code==='idempotency_conflict')
    throw new Error(errorText(e)+' Check saved orders or equipment records before submitting a new request.', { cause: e });
   throw e;
  }finally{
   setPendingMutation(readPendingMutation(browserEquipmentStore));
   writeLock.current=false;setBusy(false);
  }
 }
 async function recoverPending(){
  const attempt=readPendingMutation(browserEquipmentStore);
  if(!attempt){report(new Error('There is no pending request to recover.'));return;}
  try{
   const result=await mutate(attempt.kind,attempt.path,attempt.method,attempt.body,attempt);
   if(attempt.kind==='order'){
    setLastBatch(result.batch_id);setTab('orders');
   }else if(attempt.kind==='customer'){
    setCustomerId(result.customer.customer_id);rememberEquipmentChoice('equipment.customer',result.customer.customer_id);
    await refresh();
   }else if(attempt.kind==='unregistered'){
    setUnit(result.unit);setScan(result.unit.equipment_id);setUnregisteredType('');setTab('receive');
   }else if(attempt.kind==='labels')setTab('labels');
   else if(attempt.kind==='confirm'){
    // A recovered physical-print confirmation must not leave a stale PDF or
    // Equipment IDs visible as though the print were still unconfirmed.
    setPrintIds([]);setLastPdf(null);setPreparedTargetIds([]);setPrintTargetIds([]);
   }
   else if(attempt.kind==='receive'){
    setUnit(null);setScan('');
   }else if(attempt.kind==='cancelBatch'){
    // A recovered cancellation must not silently erase a separate unconfirmed print receipt.
    setPrintTargetIds([]);
   }
   success('Recovered the original '+attempt.kind+' request without resubmitting a new operation.');
   await loadInventory();
   if(attempt.kind==='receiveBatch'||attempt.kind==='cancelBatch')await loadBatches();
   if(['order','editOrder','cancelBatch'].includes(attempt.kind)){
    const batchId=attempt.kind==='order'?text(result.batch_id):attempt.path.match(/\/batches\/(ebt-[a-z0-9]{8})/)?.[1];
    if(batchId)setRecoveredOrder({batchId,sequence:Date.now()});
    setOrdersRefreshVersion(v=>v+1);
   }
  }catch(e){report(e);}
 }
 async function refresh(){
   const [a,b,c,d]=await Promise.all([req('/me'),req('/equipment/types'),req('/customers'),req('/zones')]);
   setMe(a);setTypes(b.items);setCustomers(c.items);setZones(d.items);
 }
 async function loadInventory(query=q,offset=0){
   const request=++inventoryRequest.current;
   try{const [items,totals]=await Promise.all([req('/equipment?q='+encodeURIComponent(query)+'&limit=100&offset='+offset),req('/equipment/reports')]);
    if(request!==inventoryRequest.current)return;
    setUnits(old=>offset?[...old,...items.items]:items.items);setStats(totals);setInventoryOffset(items.next_offset??null);
    // An initial refresh/search starts a fresh selection. Additional pages
    // retain previous selections, but drop units now reported cancelled.
    setSelected(previous=>offset?previous.filter(id=>!items.items.some((u:R)=>u.equipment_id===id&&u.status==='cancelled')):[]);}
   catch(e){if(request===inventoryRequest.current)report(e);}
 }
 async function loadBatches(query=batchSearch,offset=0){
   const request=++batchRequest.current;
   try{const result=await req('/equipment/batches?q='+encodeURIComponent(query)+'&limit=25&offset='+offset);
    if(request!==batchRequest.current)return;
    setBatches(old=>offset?[...old,...result.items]:result.items);setBatchOffset(result.next_offset??null);}
   catch(e){if(request===batchRequest.current)report(e);}
 }
 async function openBatch(batchId:string){
   try{const result=await req('/equipment/batches/'+batchId);
    setBatchData(result);setLastBatch(batchId);
    setTab('receive');}
   catch(e){report(e);}
 }
 async function loadReviews(){
   try{setReviews((await req('/equipment/reviews')).items);}
   catch(e){report(e);}
 }
 // These requests should run on tab changes, not on each keystroke in a search field.
 const loadTab=useEffectEvent((current:Tab)=>{
   if(current==='reviews')void loadReviews();
   if(current==='inventory')void loadInventory();
   if(current==='receive')void loadBatches();
   if(current==='labels')void req('/equipment/labels/reprint-needed').then(r=>setReprints(r.items)).catch(report);
 });
 const findInitialUnit=useEffectEvent((id:string)=>{void findUnit(id);});
 useEffect(()=>{void refresh().catch(report);},[]);
 useEffect(()=>{loadTab(tab);},[tab]);
 // A URL deep link is a one-time scan. Typing in the scanner must not auto-submit.
 useEffect(()=>{
   const id=new URLSearchParams(window.location.search).get('id')??'';
   if(isEquipmentId(id.trim().toLowerCase()))findInitialUnit(id);
 },[]);
 async function updateDisposition(){
  if(!unit)return;
  try{
   const updated=await mutate('status','/equipment/'+unit.equipment_id,'PATCH',{version:unit.version,changes:disposition==='returned'?{status:disposition,return_reason:returnReason,return_destination:returnDestination}:{status:disposition}});
   setUnit(updated.unit);setDisposition(text(updated.unit.status));success('Equipment status changed to '+disposition+'.');
   await loadInventory();
  }catch(e){report(e);}
 }
 async function findUnit(value:string){
  const request=++unitRequest.current;
  const id=value.trim().toLowerCase();
  if(!isEquipmentId(id)){report(new Error('Scan or enter an eqp- equipment ID.'));return;}
  try{const result=await req('/equipment/'+encodeURIComponent(id));
  if(request!==unitRequest.current)return;
  setUnit(result.unit);setSerial(text(result.unit.serial_number));setModel(text(result.unit.confirmed_model||result.unit.ordered_model));setLocationNote(text(result.unit.location_note));setZoneId(text(result.unit.zone_id));setDisposition(text(result.unit.status));setReturnReason(text(result.unit.return_reason));setReturnDestination(text(result.unit.return_destination||'warehouse'));
  setCorrection({customer_id:result.unit.customer_id,po_number:result.unit.po_number,manufacturer:result.unit.manufacturer,ordered_model:result.unit.ordered_model,expected_date:result.unit.expected_date??'',vendor:result.unit.vendor,notes:result.unit.notes,serial_number:result.unit.serial_number??'',confirmed_model:result.unit.confirmed_model??'',zone_id:result.unit.zone_id??'',location_note:result.unit.location_note??''});
  setTab('receive');success('Equipment found.');}
  catch(e){if(request===unitRequest.current)report(e);}
 }
 async function receive(){
  if(!unit)return;
  try{
   await mutate('receive','/equipment/'+unit.equipment_id+'/receive','POST',{version:unit.version,serial_number:serial,confirmed_model:model,location_note:locationNote,zone_id:zoneId||null});
   success('Received '+unit.equipment_id+'. Ready for another QR scan.');setUnit(null);setScan('');setSerial('');await loadInventory();
  }catch(e){report(e);}
 }
 async function receiveUnregistered(){
  try{
   const type=unregisteredType;
   if(!type)throw new Error('No equipment types available.');
   const result=await mutate('unregistered','/equipment/receive-unregistered','POST',{customer_id:customerId,equipment_type_id:type,model:model,serial_number:serial,po_number:po});
   setUnit(result.unit);setScan(result.unit.equipment_id);setUnregisteredType('');
   success('Unregistered equipment saved and flagged for review. Print its new label.');
   await loadInventory();
  }catch(e){report(e);}
 }
 async function receiveBatch(){
  if(!lastBatch)return;
  if(!window.confirm('Receive every remaining ordered unit in this batch without serial numbers?'))return;
   try{const result=await mutate('receiveBatch','/equipment/batches/'+lastBatch+'/receive','POST',{serials_later:true});
   success('Received '+result.affected+' remaining units; serial numbers can be captured later.');await openBatch(lastBatch);await loadInventory();
  }catch(e){report(e);}
 }
 async function prepare(){
  try{
   if(printIds.length&&lastPdf){
    const href=URL.createObjectURL(lastPdf),a=document.createElement('a');
    a.href=href;a.download='sun-city-equipment-avery-5821.pdf';a.click();
    setTimeout(()=>URL.revokeObjectURL(href),20000);
    success('Re-downloaded the existing print job without creating additional label records.');
    return;
   }
   if(!printTargetIds.length)throw new Error('Choose equipment from an order, receiving, or Inventory before printing.');
   await mutate('labels','/equipment/labels/prepare','POST',{equipment_ids:printTargetIds,skip_first_positions:Number(skip)});
   success('Avery 5821 PDF generated. Print at 100% / Actual Size, then confirm only if printed successfully.');
  }catch(e){report(e);}
 }
 async function confirmPrint(){
  try{if(!printIds.length)throw new Error('Generate PDF before confirming a print.');
   const result=await mutate('confirm','/equipment/labels/confirm','POST',{prepared_print_ids:printIds});
   success('Confirmed '+result.confirmed+' printed equipment labels.');setPrintIds([]);setLastPdf(null);setPreparedTargetIds([]);setPrintTargetIds([]);
  }catch(e){report(e);}
 }
 async function printCalibration(){
   const blob=avery5821Pdf([],true),url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='avery-5821-alignment-test.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);
 }
 async function saveCorrection(){
  if(!unit)return;
  const changes={...correction};
  if(!can('receive_edit_equipment')){delete changes.serial_number;delete changes.confirmed_model;delete changes.zone_id;delete changes.location_note;}
  if(unit.entry_batch_id)for(const key of ['customer_id','po_number','requested_by_name','expected_date','vendor','manufacturer','ordered_model'])delete changes[key];
  const original=unit as R;
  for(const key of Object.keys(changes))if(text(changes[key])===text(original[key]))delete changes[key];
  if(!Object.keys(changes).length){success('No changes to save.');return;}
  try{const saved=await mutate('correction','/equipment/'+unit.equipment_id,'PATCH',{version:unit.version,changes});
   setUnit(saved.unit);success('Equipment record updated and audited.');await loadInventory();}
  catch(e){report(e);}
 }
 async function searchMergeCustomers(){
  try{const results=await req('/customers?q='+encodeURIComponent(customerQuery));setMergeCustomers(results.items);setMergePreview(null);}
  catch(e){report(e);}
 }
 async function previewCustomerMerge(){
  if(!mergeFrom||!mergeInto)return;
  try{setMergePreview(await req('/customers/'+mergeFrom+'/merge-preview?into_customer_id='+encodeURIComponent(mergeInto)));}
  catch(e){report(e);}
 }
 async function executeCustomerMerge(){
  if(!mergePreview)return;
  if(!window.confirm('Merge '+mergePreview.from.display_name+' into '+mergePreview.into.display_name+'? This changes customer references for '+mergePreview.affected_units+' equipment units.'))return;
  try{await mutate('merge','/customers/'+mergeFrom+'/merge','POST',{into_customer_id:mergeInto});
   setMergePreview(null);setMergeFrom('');setMergeInto('');success('Customer records merged.');await searchMergeCustomers();await loadInventory();}
  catch(e){report(e);}
 }
 async function resolveReview(item:R){
  try{await mutate('review','/equipment/reviews/'+item.review_id,'PATCH',{version:item.version,state:'resolved'});await loadReviews();success('Review item resolved.');}
  catch(e){report(e);}
 }
 // A disabled cancelled checkbox can never remain visually checked or be
 // submitted, even if it was selected before a concurrent status change.
 const inventoryPrintIds=printableInventoryEquipmentIds(selected,units);
 return <div className="min-h-screen bg-[#f4f3f3] text-gray-900">
 <header className="bg-[#6B1A2C] text-white border-b-4 border-[#C9A84C] p-4">
  <div className="mx-auto max-w-5xl flex justify-between items-center gap-3"><div><h1 className="text-2xl font-extrabold">Sun City Equipment</h1><p>One unit, one QR label — order through receiving</p></div><a href="/" className="text-white underline">Warehouse home</a></div>
 </header>
 <main className="mx-auto max-w-5xl px-3 py-5">
 <nav className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5" aria-label="Equipment navigation">
 {([['orders','Equipment Orders'],['inventory','Find equipment'],['receive','Receive / scan'],['labels','Print labels'],['reviews','Needs attention'],...(can('admin')?[['customers','Customers']]:[]),...(can('manage_staff')?[['staff','Staff permissions']]:[])] as [Tab,string][]).map(([key,label])=>
 <button key={key} type="button" onClick={()=>navigate(key)} className={tab===key?button:base}>{label}</button>)}
 </nav>
 {error&&<div role="alert" className="mb-4 p-3 border border-red-500 bg-red-50 text-red-900 rounded-lg">{error}</div>}
 {notice&&<div role="status" className="mb-4 p-3 border border-[#C9A84C] bg-yellow-50 rounded-lg">{notice}</div>}
 {pendingMutation&&!busy&&<section aria-label="Pending equipment change" className="mb-4 rounded-lg border border-amber-500 bg-amber-50 p-3">
  <p className="font-bold">Uncertain {pendingMutation.kind} request</p>
  <p>Do not submit another change. Recover the original request using its exact saved key and body. If necessary, search saved equipment or batches to verify its status.</p>
  <button type="button" className={button} onClick={()=>void recoverPending()}>Recover original request</button>
 </section>}
 {!me&&<p className="p-3 bg-white rounded-lg">Checking sign-in and equipment permissions…</p>}
 {tab==='inventory'&&<section className="space-y-3">
  <h2 className="text-xl font-bold">Equipment inventory</h2>
  {stats&&<div className="grid grid-cols-2 md:grid-cols-4 gap-2">{[['Overdue',stats.overdue],['Missing serial',stats.missing_serial],['Need location',stats.without_location],['Ordered',(stats.statuses||[]).find((s:R)=>s.status==='ordered')?.total??0]].map(([label,value])=><div className="p-3 border bg-white rounded-lg" key={text(label)}><b className="text-xl">{value}</b><p className="text-sm">{label}</p></div>)}</div>}
  <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void loadInventory();}}><input className={base} placeholder="Search customer, model, PO, serial, equipment ID" value={q} onChange={e=>{setQ(e.target.value);setSelected([]);}}/><button className={button}>Search</button></form>
  <p className="text-sm text-gray-600">Select units to print their labels together.</p>
  <div className="space-y-2">{units.map(u=><article key={u.equipment_id} className="p-3 bg-white border rounded-lg flex gap-3 items-start">
   <input type="checkbox" aria-label={'Select '+u.equipment_id} disabled={u.status==='cancelled'} checked={u.status!=='cancelled'&&inventoryPrintIds.includes(u.equipment_id)}
    onChange={e=>{if(u.status==='cancelled')return;setSelected(s=>e.target.checked?[...s,u.equipment_id]:s.filter(x=>x!==u.equipment_id));setPrintTargetIds([]);}}/>
   <div className="flex-1 min-w-0"><b>{u.customer_name}</b> · {u.type_name} · {u.ordered_model}<p className="text-sm">PO {u.po_number||'—'} · {u.status} · {u.equipment_id}</p>
    {u.marker_x_in!=null&&u.marker_y_in!=null&&<a className="text-sm font-semibold underline text-[#6B1A2C]" href={'/map/?equipment='+encodeURIComponent(u.equipment_id)}>Show on warehouse map</a>}</div>
   <button className="underline text-[#6B1A2C]" onClick={()=>{setScan(u.equipment_id);void findUnit(u.equipment_id);}}>Open</button>
   </article>)}</div>
  {inventoryOffset!==null&&<button className={base} onClick={()=>void loadInventory(q,inventoryOffset)}>Load more equipment</button>}
  <button className={button} disabled={!inventoryPrintIds.length||inventoryPrintIds.length>25} onClick={()=>choosePrint(inventoryPrintIds)}>Print {inventoryPrintIds.length} selected labels</button>
 </section>}
 {tab==='orders'&&<EquipmentOrdersPanel
   types={types} customers={customers} me={me} can={can} refreshVersion={ordersRefreshVersion} recoveredOrder={recoveredOrder}
   request={req} mutate={mutate}
   onReceive={batchId=>{void openBatch(batchId);}}
   onPrint={choosePrint}
   onCustomerAdded={refresh}
  />}
 {tab==='receive'&&<section className="space-y-3">
  <h2 className="text-xl font-bold">Receive equipment</h2>
  <section className="bg-white border rounded-lg p-3 space-y-2" aria-label="Find saved orders">
   <h3 className="font-bold">Find an existing order / batch</h3>
   <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void loadBatches(batchSearch);}}>
    <input className={base} value={batchSearch} placeholder="PO, customer, batch ID, requested by" onChange={e=>setBatchSearch(e.target.value)}/>
    <button className={button}>Find orders</button>
   </form>
   <div className="max-h-56 overflow-auto space-y-1">
    {batches.map(b=><button type="button" className="block w-full text-left border rounded p-2" key={b.entry_batch_id} onClick={()=>void openBatch(b.entry_batch_id)}>
     <b>{b.customer_name}</b> · PO {b.po_number||'—'} · {b.entry_batch_id}
     <p className="text-sm">{b.received} received · {b.remaining} remaining · {b.cancelled} cancelled · {b.total} total</p>
    </button>)}
   </div>
   {batchOffset!==null&&<button type="button" className={base} onClick={()=>void loadBatches(batchSearch,batchOffset)}>More orders</button>}
   {batchData&&<div className="p-3 border rounded-lg space-y-2">
    <h4 className="font-bold">{batchData.batch.customer_name} · PO {batchData.batch.po_number}</h4>
    <p>{batchData.received} received · {batchData.remaining} remaining · {batchData.cancelled} cancelled · {batchData.total} total</p>
    {batchData.units.map((u:R)=><button type="button" key={u.equipment_id} onClick={()=>void findUnit(u.equipment_id)} className="block text-left w-full border-b p-1">
     {u.equipment_id} · {u.type_name} · {u.ordered_model} · {u.status}</button>)}
    <button type="button" className={button} disabled={!can('receive_edit_equipment')||!batchData.remaining} onClick={()=>void receiveBatch()}>Receive {batchData.remaining} remaining units — serials later</button>
    <button type="button" className={base} disabled={!printableOrderEquipmentIds(batchData.units).length}
     onClick={()=>choosePrint(printableOrderEquipmentIds(batchData.units))}>Print this order's eligible labels</button>
   </div>}
  </section>
  <form onSubmit={e=>{e.preventDefault();void findUnit(scan);}} className="flex gap-2"><input autoFocus className={base} placeholder="Scan or enter eqp- ID" value={scan} onChange={e=>setScan(e.target.value)}/><button className={button}>Find QR</button></form>
  {unit?<article className="bg-white p-4 border rounded-lg space-y-3">
   <h3 className="font-bold text-xl">{unit.customer_name||'Equipment'} · {unit.type_name||unit.equipment_type_id}</h3>
   <p>{unit.equipment_id} · {unit.status} · PO {unit.po_number||'No PO'}</p><p>Ordered model: {unit.ordered_model||'Not specified'}</p>
    {(unit.manufacturer_unknown||unit.model_unknown)&&<p role="note" className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900">Missing {unit.manufacturer_unknown?'manufacturer ':''}{unit.model_unknown?'model ':''}information. Correct the saved order before receiving.</p>}
   {unit.marker_x_in!=null&&unit.marker_y_in!=null&&<a className="font-semibold underline text-[#6B1A2C]" href={'/map/?equipment='+encodeURIComponent(unit.equipment_id)}>Find staged equipment on map</a>}
   {can('receive_edit_equipment')&&<a className="block underline text-[#6B1A2C]" href={'/map/'}>Place or move equipment on warehouse map</a>}
   <label className="block">Serial number <input className={base} value={serial} onChange={e=>setSerial(e.target.value)} placeholder="Scan/type serial (may be blank)"/></label>
   <label className="block">Confirmed model <input className={base} value={model} onChange={e=>setModel(e.target.value)}/></label>
   <label className="block">Warehouse zone <select className={base} value={zoneId} onChange={e=>setZoneId(e.target.value)}><option value="">Not assigned yet</option>{zones.map(z=><option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}</select></label>
   <label className="block">Location notes <input className={base} value={locationNote} onChange={e=>setLocationNote(e.target.value)}/></label>
   <button className={button} disabled={!can('receive_edit_equipment')||unit.status!=='ordered'} onClick={receive}>Mark received</button>
   <button className={base} disabled={unit.status==='cancelled'} onClick={()=>choosePrint([unit.equipment_id])}>Print this equipment label</button>
   {(can('receive_edit_equipment')||(can('order_equipment')&&unit.entered_by_email===me?.email&&unit.status==='ordered'))&&
    <details className="border rounded p-3 space-y-2"><summary className="cursor-pointer font-bold">Correct equipment details</summary>
     <div className="space-y-2 py-2">
      {unit.entry_batch_id&&<p className="text-sm rounded bg-amber-50 p-2">Shared manufacturer, model, customer, PO and order information must be corrected in Equipment Orders.</p>}
      {!unit.entry_batch_id&&<><label className="block">Customer<select className={base} value={text(correction.customer_id)} onChange={e=>setCorrection(p=>({...p,customer_id:e.target.value}))}>
       {customers.map(c=><option key={c.customer_id} value={c.customer_id}>{c.display_name}</option>)}</select></label>
      {([['po_number','PO number'],['manufacturer','Manufacturer'],['ordered_model','Ordered model'],['expected_date','Expected date (YYYY-MM-DD)'],['vendor','Vendor'],['notes','Notes']] as [string,string][]).map(([key,label])=>
       <label className="block" key={key}>{label}<input className={base} value={text(correction[key])} onChange={e=>setCorrection(p=>({...p,[key]:e.target.value}))}/></label>)}</>}
      {can('receive_edit_equipment')&&<>
       {([['serial_number','Correct serial'],['confirmed_model','Correct confirmed model'],['location_note','Correct location notes']] as [string,string][]).map(([key,label])=>
        <label className="block" key={key}>{label}<input className={base} value={text(correction[key])} onChange={e=>setCorrection(p=>({...p,[key]:e.target.value}))}/></label>)}
       <label className="block">Correct warehouse zone<select className={base} value={text(correction.zone_id)} onChange={e=>setCorrection(p=>({...p,zone_id:e.target.value}))}>
        <option value="">Unassigned</option>{zones.map(z=><option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}</select></label>
      </>}
      <button className={button} type="button" onClick={()=>void saveCorrection()}>Save equipment corrections</button>
     </div>
    </details>}
   {unit.status!=='ordered'&&unit.status!=='cancelled'&&unit.status!=='returned'&&can('receive_edit_equipment')&&
    <div className="border-t pt-3 space-y-2">
     <label className="block">Disposition / next status<select className={base} value={disposition} onChange={e=>setDisposition(e.target.value)}>
      {['received','in_stock','reserved','installed','delivered','returned'].map(s=><option value={s} key={s}>{s.replaceAll('_',' ')}</option>)}
     </select></label>
     {disposition==='returned'&&<div className="space-y-2">
      <label className="block">Return reason<input className={base} value={returnReason} onChange={e=>setReturnReason(e.target.value)} placeholder="Reason for return"/></label>
      <label className="block">Return destination<select className={base} value={returnDestination} onChange={e=>setReturnDestination(e.target.value)}>
       {['warehouse','vendor','customer'].map(d=><option value={d} key={d}>{d}</option>)}
      </select></label>
     </div>}
     <button className={button} disabled={disposition===unit.status||(disposition==='returned'&&!returnReason.trim())} onClick={updateDisposition}>Update status</button>
    </div>}

  </article>:<div className="bg-white rounded-lg p-4">Scan an equipment QR code to open its receiving record.</div>}
  <details className="bg-white p-4 rounded-lg border"><summary className="font-semibold cursor-pointer">Receive an unregistered unit (no prior order)</summary>
    <p className="my-2 text-sm">Enter the customer, PO and equipment details. Missing order history is flagged for review.</p>
    <label className="block">Equipment type<select className={base} value={unregisteredType} onChange={e=>setUnregisteredType(e.target.value)}><option value="">Choose type…</option>{types.map(t=><option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}</select></label>
    <label className="block">Customer<select className={base} value={customerId} onChange={e=>setCustomerId(e.target.value)}>{customers.map(c=><option key={c.customer_id} value={c.customer_id}>{c.display_name}</option>)}</select></label>
    <label className="block">PO number<input className={base} value={po} onChange={e=>setPo(e.target.value)}/></label>
    <label className="block">Model<input className={base} value={model} onChange={e=>setModel(e.target.value)}/></label>
    <label className="block">Serial<input className={base} value={serial} onChange={e=>setSerial(e.target.value)}/></label>
    <button className={button} disabled={!can('receive_edit_equipment')||!unregisteredType} onClick={receiveUnregistered}>Create received unit and review flag</button>
  </details>

 </section>}
 {tab==='labels'&&<section className="bg-white border rounded-xl p-4 space-y-3">
  <h2 className="text-xl font-bold">Avery 5821 equipment labels</h2>
  <p>US Letter · 2 columns × 4 rows · 4 × 2.5 inches per label. QR contains only its equipment ID. Print up to 25 units per job.</p>
  <p>{printTargetIds.length} explicit label target(s) selected</p>
  {printTargetIds.length>0?<div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
   <p className="font-semibold">Verify these exact Equipment IDs before generating a new PDF:</p>
   <ul aria-label="Equipment IDs to print" className="grid gap-1 sm:grid-cols-2">
    {printTargetIds.map(id=><li key={id}><code className="font-mono text-sm">{id}</code></li>)}
   </ul></div>:<p role="note" className="text-sm text-gray-600">No new print selection. Select eligible Equipment IDs in Orders, Inventory or Receiving before generating a new PDF.</p>}
  {printIds.length>0&&preparedTargetIds.length>0&&<div className="rounded-lg border p-3 space-y-2">
   <p className="font-semibold">Existing prepared PDF — confirm only after physically printing:</p>
   <ul aria-label="Equipment IDs in prepared PDF" className="grid gap-1 sm:grid-cols-2">
    {preparedTargetIds.map(id=><li key={id}><code className="font-mono text-sm">{id}</code></li>)}
   </ul></div>}

  <label className="block max-w-xs">Used positions on first sheet <select className={base} value={skip} onChange={e=>{const next=Number(e.target.value);if(next===skip||!confirmDiscardUnconfirmedPrintJob('change the used label positions'))return;setSkip(next);setLastPdf(null);setPrintIds([]);setPreparedTargetIds([]);}}>{Array.from({length:8},(_,i)=><option value={i} key={i}>{i}</option>)}</select></label>
  <div className="flex gap-2 flex-wrap">
   <button className={button} onClick={prepare} disabled={busy||(!printTargetIds.length&&!(printIds.length&&lastPdf))||printTargetIds.length>25}>{printIds.length&&lastPdf?'Re-download same equipment PDF':'Generate / download equipment PDF'}</button>
   <button className={base} style={{width:'auto'}} onClick={printCalibration}>Download 1-inch alignment test</button>
   <button className={button} onClick={confirmPrint} disabled={!printIds.length||!lastPdf}>Confirm physically printed</button>
  </div>
  <p className="text-sm">Print using <strong>Actual Size / 100%</strong>. Downloading a PDF does not mark equipment labels as physically printed.</p>
  {reprints.some(u=>u.status!=='cancelled')&&<div className="border-t pt-3"><h3 className="font-bold">Reprint needed ({reprints.filter(u=>u.status!=='cancelled').length})</h3>{reprints.filter(u=>u.status!=='cancelled').map(u=><button key={u.equipment_id} className="underline block" onClick={()=>choosePrint([u.equipment_id])}>{u.customer_name} · {u.equipment_id}</button>)}</div>}
 </section>}
 {tab==='customers'&&can('admin')&&<section className="bg-white border rounded-xl p-4 space-y-3">
  <h2 className="text-xl font-bold">Customer duplicate management</h2>
  <p>Search for source and destination records; review the number of affected equipment units before merging. STOCK is protected.</p>
  <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void searchMergeCustomers();}}>
   <input className={base} value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} placeholder="Customer name"/>
   <button className={button}>Search</button>
  </form>
  <label>Merge FROM (duplicate)<select className={base} value={mergeFrom} onChange={e=>{setMergeFrom(e.target.value);setMergePreview(null);}}>
   <option value="">Select source</option>{mergeCustomers.filter(c=>!c.is_stock).map(c=><option key={c.customer_id} value={c.customer_id}>{c.display_name}</option>)}</select></label>
  <label>Merge INTO (keep this customer)<select className={base} value={mergeInto} onChange={e=>{setMergeInto(e.target.value);setMergePreview(null);}}>
   <option value="">Select destination</option>{mergeCustomers.filter(c=>!c.is_stock).map(c=><option key={c.customer_id} value={c.customer_id}>{c.display_name}</option>)}</select></label>
  <button className={button} disabled={!mergeFrom||!mergeInto||mergeFrom===mergeInto} onClick={()=>void previewCustomerMerge()}>Preview merge impact</button>
  {mergePreview&&<div className="border border-amber-300 rounded p-3">
   <p>Merge <b>{mergePreview.from.display_name}</b> into <b>{mergePreview.into.display_name}</b>.</p>
   <p>Updates {mergePreview.affected_units} equipment records and {mergePreview.affected_batches} entry batches.</p>
   <button className={button} onClick={()=>void executeCustomerMerge()}>Confirm merge</button>
  </div>}
 </section>}
 {tab==='staff'&&can('manage_staff')&&<StaffPanel/>}
 {tab==='reviews'&&<section className="space-y-3">
  <h2 className="text-xl font-bold">Needs attention</h2>
  <p>Model discrepancies, duplicate serials, and unregistered arrivals are flagged without blocking receiving.</p>
  {reviews.map(r=><article key={r.review_id} className="bg-white border p-3 rounded-lg"><b>{r.issue_code}</b> · {r.entity_id}<p className="text-sm">{r.detail_json}</p><button className={button} onClick={()=>resolveReview(r)}>Resolve</button></article>)}
  {!reviews.length&&<p>No review items loaded.</p>}
 </section>}
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
