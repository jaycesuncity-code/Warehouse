import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isEquipmentId } from '../shared/ids';
import { avery5821Pdf, type EquipmentLabel } from './pdf';
import { StaffPanel } from './StaffPanel';
import '../shared/ui/styles.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
type Tab = 'orders'|'receive'|'inventory'|'reviews'|'labels'|'staff';
const base = 'rounded-lg border border-gray-300 bg-white px-3 py-2 w-full text-gray-900';
const button = 'rounded-lg px-4 py-3 font-bold border border-[#6B1A2C] bg-[#6B1A2C] text-white disabled:opacity-50';
async function req(path:string,method='GET',body?:R):Promise<R> {
 const response = await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
 let parsed:R;
 try{parsed=await response.json();}catch{throw new Error('Server returned an invalid response. Check the warehouse deployment.');}
 if(!response.ok)throw new Error(parsed.message||'Request failed ('+response.status+')');
 return parsed;
}
const text = (value:unknown) => String(value??'');
const errorText = (e:unknown) => e instanceof Error?e.message:String(e);
function App(){
 const [tab,setTab]=useState<Tab>('inventory'),[me,setMe]=useState<R|null>(null),[types,setTypes]=useState<R[]>([]),[customers,setCustomers]=useState<R[]>([]);
 const [units,setUnits]=useState<R[]>([]),[reviews,setReviews]=useState<R[]>([]),[zones,setZones]=useState<R[]>([]),[stats,setStats]=useState<R|null>(null),[reprints,setReprints]=useState<R[]>([]),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [q,setQ]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const [customerSearch,setCustomerSearch]=useState(''),[newCustomer,setNewCustomer]=useState(''),[nearDuplicates,setNearDuplicates]=useState<R[]>([]);
 const [customerId,setCustomerId]=useState(sessionStorage.getItem('equipment.customer')??'cus-stk22222'),[po,setPo]=useState(sessionStorage.getItem('equipment.po')??'');
 const [requester,setRequester]=useState(''),[expected,setExpected]=useState(''),[vendor,setVendor]=useState('');
 const [lines,setLines]=useState<R[]>([{equipment_type_id:'',manufacturer:'',model:'',quantity:1}]);
 const [modelHints,setModelHints]=useState<Record<string,string[]>>({});
 const [unregisteredType,setUnregisteredType]=useState('');
 const [scan,setScan]=useState(new URLSearchParams(location.search).get('id')??''),[unit,setUnit]=useState<R|null>(null);
 const [serial,setSerial]=useState(''),[model,setModel]=useState(''),[locationNote,setLocationNote]=useState(''),[zoneId,setZoneId]=useState(''),[disposition,setDisposition]=useState('received'),[returnReason,setReturnReason]=useState(''),[returnDestination,setReturnDestination]=useState('warehouse');
 const [lastBatch,setLastBatch]=useState(''),[skip,setSkip]=useState(0),[printIds,setPrintIds]=useState<string[]>([]);
 const [lastPdf,setLastPdf]=useState<Blob|null>(null);
 const rights=me?.permissions??[];
 const can=(p:string)=>rights.includes('admin')||rights.includes(p);
 function report(e:unknown){setError(errorText(e));setNotice('');}
 function success(message:string){setNotice(message);setError('');}
 async function refresh(){
   const [a,b,c,d]=await Promise.all([req('/me'),req('/equipment/types'),req('/customers'),req('/zones')]);
   setMe(a);setTypes(b.items);setCustomers(c.items);setZones(d.items);
 }
 async function loadInventory(query=q){
   try{const [items,totals]=await Promise.all([req('/equipment?q='+encodeURIComponent(query)+'&limit=100'),req('/equipment/reports')]);setUnits(items.items);setStats(totals);}
   catch(e){report(e);}
 }
 async function loadReviews(){
   try{setReviews((await req('/equipment/reviews')).items);}
   catch(e){report(e);}
 }
 useEffect(()=>{refresh().catch(report);loadInventory('');},[]);
 useEffect(()=>{if(tab==='reviews')loadReviews();if(tab==='inventory')loadInventory();if(tab==='labels')req('/equipment/labels/reprint-needed').then(r=>setReprints(r.items)).catch(report);},[tab]);
 useEffect(()=>{if(scan&&isEquipmentId(scan.trim().toLowerCase()))void findUnit(scan);},[]);
 useEffect(()=>{
   const timer=setTimeout(()=>{req('/customers?q='+encodeURIComponent(customerSearch)).then(r=>setCustomers(r.items)).catch(()=>undefined);},200);
   return ()=>clearTimeout(timer);
 },[customerSearch]);
 useEffect(()=>{
   if(newCustomer.trim().length<3){setNearDuplicates([]);return;}
   const timer=setTimeout(async()=>{
     try{
       const name=newCustomer.trim().toLowerCase();
       const matches=(await req('/customers?q='+encodeURIComponent(name.slice(0,Math.min(4,name.length))))).items as R[];
       setNearDuplicates(matches.filter(x=>text(x.display_name).toLowerCase().startsWith(name.slice(0,Math.min(4,name.length)))));}
     catch{setNearDuplicates([]);}
   },280);
   return ()=>clearTimeout(timer);
 },[newCustomer]);
 const filteredCustomers=useMemo(()=>customers.filter(c=>text(c.display_name).toLowerCase().includes(customerSearch.toLowerCase())).slice(0,15),[customers,customerSearch]);
 function editLine(i:number,key:string,value:unknown){setLines(old=>old.map((line,j)=>i===j?{...line,[key]:value}:line));}
 async function loadModelHints(typeId:string){
  if(!typeId||modelHints[typeId])return;
  try{const result=await req('/equipment/models?type_id='+encodeURIComponent(typeId));
    setModelHints(prev=>({...prev,[typeId]:result.items.map((m:R)=>text(m.model)).filter(Boolean)}));}
  catch(e){report(e);}
 }
 async function updateDisposition(){
  if(!unit)return;
  try{
   const updated=await req('/equipment/'+unit.equipment_id,'PATCH',{version:unit.version,changes:disposition==='returned'?{status:disposition,return_reason:returnReason,return_destination:returnDestination}:{status:disposition}});
   setUnit(updated.unit);setDisposition(text(updated.unit.status));success('Equipment status changed to '+disposition+'.');
   await loadInventory();
  }catch(e){report(e);}
 }
 async function createCustomer(){
  try{
    const result=await req('/customers','POST',{display_name:newCustomer.trim()});
    await refresh();setCustomerId(result.customer.customer_id);sessionStorage.setItem('equipment.customer',result.customer.customer_id);setNewCustomer('');
    success(result.similar_customers.length?'Customer created. Similar existing customers: '+result.similar_customers.map((c:R)=>c.display_name).join(', '):'Customer added.');
  }catch(e){report(e);}
 }
 async function order(){
  try{
    const result=await req('/equipment/orders','POST',{header:{customer_id:customerId,po_number:po,requested_by_name:requester||me?.name,expected_date:expected||null,vendor},
     lines:lines.map(l=>({...l,quantity:Number(l.quantity)||1}))});
    sessionStorage.setItem('equipment.po',po);sessionStorage.setItem('equipment.customer',customerId);setLastBatch(result.batch_id);
    setSelected(result.unit_ids);success('Ordered '+result.unit_ids.length+' individual units. IDs saved. Print labels from the saved batch.');
    setTab('labels');await loadInventory();
  }catch(e){report(e);}
 }
 async function findUnit(value:string){
  const id=value.trim().toLowerCase();
  if(!isEquipmentId(id)){report(new Error('Scan or enter an eqp- equipment ID.'));return;}
  try{const result=await req('/equipment/'+encodeURIComponent(id));setUnit(result.unit);setSerial(text(result.unit.serial_number));setModel(text(result.unit.confirmed_model||result.unit.ordered_model));setLocationNote(text(result.unit.location_note));setZoneId(text(result.unit.zone_id));setDisposition(text(result.unit.status));setReturnReason(text(result.unit.return_reason));setReturnDestination(text(result.unit.return_destination||'warehouse'));setTab('receive');success('Equipment found.');}
  catch(e){report(e);}
 }
 async function receive(){
  if(!unit)return;
  try{
   await req('/equipment/'+unit.equipment_id+'/receive','POST',{version:unit.version,serial_number:serial,confirmed_model:model,location_note:locationNote,zone_id:zoneId||null});
   success('Received '+unit.equipment_id+'. Ready for another QR scan.');setUnit(null);setScan('');setSerial('');await loadInventory();
  }catch(e){report(e);}
 }
 async function receiveUnregistered(){
  try{
   const type=unregisteredType;
   if(!type)throw new Error('No equipment types available.');
   const result=await req('/equipment/receive-unregistered','POST',{customer_id:customerId,equipment_type_id:type,model:model,serial_number:serial,po_number:po});
   setUnit(result.unit);setScan(result.unit.equipment_id);success('Unregistered equipment saved and flagged for review. Print its new label.');
   await loadInventory();
  }catch(e){report(e);}
 }
 async function receiveBatch(){
  if(!lastBatch)return;
  try{const result=await req('/equipment/batches/'+lastBatch+'/receive','POST',{serials_later:true});
   success('Received '+result.affected+' units; serials can be captured later.');await loadInventory();
  }catch(e){report(e);}
 }
 async function cancelBatch(){
  if(!lastBatch||!window.confirm('Cancel all units still ordered in this batch? Received units will not be cancelled.'))return;
  try{
   const result=await req('/equipment/batches/'+lastBatch+'/cancel','POST',{});
   setSelected([]);setPrintIds([]);setLastPdf(null);
   success('Cancelled '+result.affected+' remaining ordered units. The audit history is preserved.');
   await loadInventory();
  }catch(e){report(e);}
 }
 async function prepare(){
  try{
   let ids=selected.length?selected:unit?[unit.equipment_id]:[];
   if(lastBatch&&!ids.length){const batch=await req('/equipment/batches/'+lastBatch);ids=batch.units.map((u:R)=>u.equipment_id);}
   if(!ids.length)throw new Error('Select equipment from Inventory first.');
   const result=await req('/equipment/labels/prepare','POST',{equipment_ids:ids,skip_first_positions:Number(skip)});
   const blob=avery5821Pdf(result.labels as EquipmentLabel[]);
   setLastPdf(blob);setPrintIds(result.labels.map((x:R)=>x.label_print_id));
   const href=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=href;anchor.download='sun-city-equipment-avery-5821.pdf';anchor.click();
   setTimeout(()=>URL.revokeObjectURL(href),20000);
   success('Avery 5821 PDF generated. Print at 100% / Actual Size, then confirm only if printed successfully.');
  }catch(e){report(e);}
 }
 async function confirmPrint(){
  try{if(!printIds.length)throw new Error('Generate PDF before confirming a print.');
   const result=await req('/equipment/labels/confirm','POST',{prepared_print_ids:printIds});
   success('Confirmed '+result.confirmed+' printed equipment labels.');setPrintIds([]);
  }catch(e){report(e);}
 }
 async function printCalibration(){
   const blob=avery5821Pdf([],true),url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='avery-5821-alignment-test.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);
 }
 async function resolveReview(item:R){
  try{await req('/equipment/reviews/'+item.review_id,'PATCH',{version:item.version,state:'resolved'});await loadReviews();success('Review item resolved.');}
  catch(e){report(e);}
 }
 return <div className="min-h-screen bg-[#f4f3f3] text-gray-900">
 <header className="bg-[#6B1A2C] text-white border-b-4 border-[#C9A84C] p-4">
  <div className="mx-auto max-w-5xl flex justify-between items-center gap-3"><div><h1 className="text-2xl font-extrabold">Sun City Equipment</h1><p>One unit, one QR label — order through receiving</p></div><a href="/" className="text-white underline">Warehouse home</a></div>
 </header>
 <main className="mx-auto max-w-5xl px-3 py-5">
 <nav className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5" aria-label="Equipment navigation">
 {([['inventory','Find equipment'],['orders','Order equipment'],['receive','Receive / scan'],['labels','Print labels'],['reviews','Needs attention'],...(can('manage_staff')?[['staff','Staff permissions']]:[])] as [Tab,string][]).map(([key,label])=>
 <button key={key} type="button" onClick={()=>{setTab(key);setError('');}} className={tab===key?button:base}>{label}</button>)}
 </nav>
 {error&&<div role="alert" className="mb-4 p-3 border border-red-500 bg-red-50 text-red-900 rounded-lg">{error}</div>}
 {notice&&<div role="status" className="mb-4 p-3 border border-[#C9A84C] bg-yellow-50 rounded-lg">{notice}</div>}
 {!me&&<p className="p-3 bg-white rounded-lg">Checking sign-in and equipment permissions…</p>}
 {tab==='inventory'&&<section className="space-y-3">
  <h2 className="text-xl font-bold">Equipment inventory</h2>
  {stats&&<div className="grid grid-cols-2 md:grid-cols-4 gap-2">{[['Overdue',stats.overdue],['Missing serial',stats.missing_serial],['Need location',stats.without_location],['Ordered',(stats.statuses||[]).find((s:R)=>s.status==='ordered')?.total??0]].map(([label,value])=><div className="p-3 border bg-white rounded-lg" key={text(label)}><b className="text-xl">{value}</b><p className="text-sm">{label}</p></div>)}</div>}
  <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void loadInventory();}}><input className={base} placeholder="Search customer, model, PO, serial, equipment ID" value={q} onChange={e=>setQ(e.target.value)}/><button className={button}>Search</button></form>
  <p className="text-sm text-gray-600">Select units to print their labels together.</p>
  <div className="space-y-2">{units.map(u=><article key={u.equipment_id} className="p-3 bg-white border rounded-lg flex gap-3 items-start">
   <input type="checkbox" aria-label={'Select '+u.equipment_id} checked={selected.includes(u.equipment_id)}
    onChange={e=>{setSelected(s=>e.target.checked?[...s,u.equipment_id]:s.filter(x=>x!==u.equipment_id));setPrintIds([]);setLastPdf(null);}}/>
   <div className="flex-1 min-w-0"><b>{u.customer_name}</b> · {u.type_name} · {u.ordered_model}<p className="text-sm">PO {u.po_number||'—'} · {u.status} · {u.equipment_id}</p></div>
   <button className="underline text-[#6B1A2C]" onClick={()=>{setScan(u.equipment_id);void findUnit(u.equipment_id);}}>Open</button>
   </article>)}</div>
  <button className={button} disabled={!selected.length} onClick={()=>setTab('labels')}>Print {selected.length} selected labels</button>
 </section>}
 {tab==='orders'&&<section className="bg-white border rounded-xl p-4 space-y-4">
  <h2 className="text-xl font-bold">Order equipment</h2><p>Enter the order header once. Every quantity becomes a separate tracked unit with its own QR code.</p>
  <label className="block font-semibold">Customer <input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} className={base} placeholder="Find customer"/></label>
  <div className="max-h-40 overflow-y-auto border rounded-lg">
   {filteredCustomers.map(c=><button type="button" key={c.customer_id} className={'block w-full text-left p-2 border-b '+(customerId===c.customer_id?'bg-yellow-100 font-bold':'')} onClick={()=>{setCustomerId(c.customer_id);sessionStorage.setItem('equipment.customer',c.customer_id);}}>{c.display_name}{customerId===c.customer_id?' ✓':''}</button>)}
  </div>
  <div className="flex gap-2"><input className={base} placeholder="New customer name" value={newCustomer} onChange={e=>setNewCustomer(e.target.value)}/><button className={button} onClick={createCustomer} disabled={!newCustomer.trim()}>Add customer</button></div>
  {nearDuplicates.length>0&&<p className="p-2 bg-yellow-50 border rounded-lg text-sm">Similar customers already exist: {nearDuplicates.map(c=>text(c.display_name)).join(', ')}. Check before creating another; you can still add this customer.</p>}
  <div className="grid md:grid-cols-2 gap-3">
   <label>PO # <input className={base} value={po} onChange={e=>setPo(e.target.value)} placeholder="Keep leading zeroes"/></label>
   <label>Requested by <input className={base} value={requester} onChange={e=>setRequester(e.target.value)} placeholder="Name"/></label>
   <label>Expected date <input className={base} type="date" value={expected} onChange={e=>setExpected(e.target.value)}/></label>
   <label>Vendor <input className={base} value={vendor} onChange={e=>setVendor(e.target.value)}/></label>
  </div>
  <h3 className="font-bold">Equipment lines</h3>
  {lines.map((line,i)=><div className="grid md:grid-cols-5 gap-2 p-3 border rounded-lg" key={i}>
   <label>Type <select className={base} value={line.equipment_type_id} onChange={e=>editLine(i,'equipment_type_id',e.target.value)}><option value="">Choose…</option>{types.map(t=><option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} — {t.department}</option>)}</select></label>
   <label>Manufacturer <input className={base} value={line.manufacturer} onChange={e=>editLine(i,'manufacturer',e.target.value)}/></label>
   <label>Model <input className={base} list={'equipment-models-'+i} value={line.model} onFocus={()=>void loadModelHints(line.equipment_type_id)} onChange={e=>editLine(i,'model',e.target.value)}/><datalist id={'equipment-models-'+i}>{(modelHints[line.equipment_type_id]||[]).map(m=><option key={m} value={m}/>)}</datalist></label>
   <label>Quantity <input className={base} type="number" min="1" max="25" value={line.quantity} onChange={e=>editLine(i,'quantity',Number(e.target.value))}/></label>
   <button className="underline" disabled={lines.length===1} onClick={()=>setLines(s=>s.filter((_,j)=>j!==i))}>Remove line</button>
  </div>)}
  <div className="flex flex-wrap gap-2"><button className={base} style={{width:'auto'}} onClick={()=>setLines(s=>[...s,{equipment_type_id:'',manufacturer:'',model:'',quantity:1}])}>+ Add line</button>
   <button className={button} disabled={!can('order_equipment')} onClick={order}>Save {lines.reduce((n,l)=>n+(Number(l.quantity)||0),0)} equipment units</button></div>
  {!can('order_equipment')&&<p role="note">Your administrator must grant <code>order_equipment</code> to place orders.</p>}
 </section>}
 {tab==='receive'&&<section className="space-y-3">
  <h2 className="text-xl font-bold">Receive equipment</h2>
  <form onSubmit={e=>{e.preventDefault();void findUnit(scan);}} className="flex gap-2"><input autoFocus className={base} placeholder="Scan or enter eqp- ID" value={scan} onChange={e=>setScan(e.target.value)}/><button className={button}>Find QR</button></form>
  {unit?<article className="bg-white p-4 border rounded-lg space-y-3">
   <h3 className="font-bold text-xl">{unit.customer_name||'Equipment'} · {unit.type_name||unit.equipment_type_id}</h3>
   <p>{unit.equipment_id} · {unit.status} · PO {unit.po_number||'—'}</p><p>Ordered model: {unit.ordered_model||'Not specified'}</p>
   <label className="block">Serial number <input className={base} value={serial} onChange={e=>setSerial(e.target.value)} placeholder="Scan/type serial (may be blank)"/></label>
   <label className="block">Confirmed model <input className={base} value={model} onChange={e=>setModel(e.target.value)}/></label>
   <label className="block">Warehouse zone <select className={base} value={zoneId} onChange={e=>setZoneId(e.target.value)}><option value="">Not assigned yet</option>{zones.map(z=><option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}</select></label>
   <label className="block">Location notes <input className={base} value={locationNote} onChange={e=>setLocationNote(e.target.value)}/></label>
   <button className={button} disabled={!can('receive_edit_equipment')||unit.status!=='ordered'} onClick={receive}>Mark received</button>
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
  {lastBatch&&<button className={button} disabled={!can('receive_edit_equipment')} onClick={receiveBatch}>Receive all remaining ordered units in last batch, serials later</button>}
 </section>}
 {tab==='labels'&&<section className="bg-white border rounded-xl p-4 space-y-3">
  <h2 className="text-xl font-bold">Avery 5821 equipment labels</h2>
  <p>US Letter · 2 columns × 4 rows · 4 × 2.5 inches per label. QR contains only its equipment ID.</p>
  <p>{selected.length} unit(s) selected{lastBatch?' · Last order batch '+lastBatch:''}</p>
  {lastBatch&&<button className="underline text-[#6B1A2C]" onClick={cancelBatch}>Cancel remaining ordered units from last batch</button>}
  <label className="block max-w-xs">Used positions on first sheet <select className={base} value={skip} onChange={e=>{setSkip(Number(e.target.value));setLastPdf(null);setPrintIds([]);}}>{Array.from({length:8},(_,i)=><option value={i} key={i}>{i}</option>)}</select></label>
  <div className="flex gap-2 flex-wrap">
   <button className={button} onClick={prepare} disabled={!selected.length&&!unit&&!lastBatch}>Generate / download equipment PDF</button>
   <button className={base} style={{width:'auto'}} onClick={printCalibration}>Download 1-inch alignment test</button>
   <button className={button} onClick={confirmPrint} disabled={!printIds.length||!lastPdf}>Confirm physically printed</button>
  </div>
  <p className="text-sm">Print using <strong>Actual Size / 100%</strong>. Downloading a PDF does not mark equipment labels as physically printed.</p>
  {reprints.length>0&&<div className="border-t pt-3"><h3 className="font-bold">Reprint needed ({reprints.length})</h3>{reprints.map(u=><button key={u.equipment_id} className="underline block" onClick={()=>{setSelected([u.equipment_id]);setPrintIds([]);setLastPdf(null);}}>{u.customer_name} · {u.equipment_id}</button>)}</div>}
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
