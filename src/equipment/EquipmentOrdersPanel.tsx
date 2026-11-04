/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { EquipmentApiError } from './recoverable';

type RecordRow = Record<string, any>; // Matches the existing equipment API's flexible response shape.
type Line = {entry_line_id?:string;equipment_type_id:string;manufacturer:string;model:string;quantity:number;manufacturer_unknown:boolean;model_unknown:boolean};
type Headers = {customer_id:string;po_number:string;vendor:string;requested_by_name:string;expected_date:string;notes:string};
type Props = {
 types:RecordRow[]; customers:RecordRow[]; me:RecordRow|null; can:(permission:string)=>boolean;
 request:(path:string,method?:string,body?:RecordRow)=>Promise<RecordRow>;
 refreshVersion?:number;
 recoveredOrder?:{batchId:string;sequence:number}|null;
 mutate:(kind:string,path:string,method:'POST'|'PATCH',body:RecordRow)=>Promise<RecordRow>;
 onReceive:(batchId:string)=>void; onPrint:(ids:string[])=>void; onCustomerAdded:()=>Promise<void>;
};
const input='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900';
const primary='rounded-lg border border-[#6B1A2C] bg-[#6B1A2C] px-4 py-2.5 font-bold text-white disabled:opacity-40';
const secondary='rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-semibold text-[#6B1A2C] disabled:opacity-40';
const blankLine=():Line=>({equipment_type_id:'',manufacturer:'',model:'',quantity:1,manufacturer_unknown:false,model_unknown:false});
const blankHeader=(customerId:string,name:string):Headers=>({customer_id:customerId,po_number:'',vendor:'',requested_by_name:name,expected_date:'',notes:''});
const reasons=['Customer cancelled','Ordered by mistake','Supplier unavailable','Equipment changed','Duplicate order','Other'];
const count=(items:Line[])=>items.reduce((sum,x)=>sum+Number(x.quantity||0),0);
const required=(line:Line)=>line.equipment_type_id&&(line.manufacturer.trim()||line.manufacturer_unknown)&&(line.model.trim()||line.model_unknown);
const displayDate=(value:unknown)=>value?String(value).slice(0,10):'Not set';
const parseJSON=(value:unknown)=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return value;}};
export function EquipmentOrdersPanel({types,customers,me,can,request,mutate,onReceive,onPrint,onCustomerAdded,refreshVersion=0,recoveredOrder=null}:Props) {
 const stock=customers.find(c=>c.is_stock)?.customer_id||'cus-stk22222';
 const [view,setView]=useState<'list'|'new'|'review'|'saved'|'details'|'edit'>('list');
 const [orders,setOrders]=useState<RecordRow[]>([]);
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('outstanding'),[offset,setOffset]=useState<number|null>(null);
 const [selected,setSelected]=useState<RecordRow|null>(null),[selectedId,setSelectedId]=useState('');
 const [header,setHeader]=useState<Headers>(blankHeader(stock,me?.name||''));
 const [lines,setLines]=useState<Line[]>([blankLine()]);
 const [expanded,setExpanded]=useState<string[]>([]);
 const [cancelIds,setCancelIds]=useState<string[]>([]);
 const [reason,setReason]=useState(''),[reasonOther,setReasonOther]=useState('');
 const [customerQuery,setCustomerQuery]=useState('');
 const [customerMatches,setCustomerMatches]=useState<RecordRow[]>([]);
 const [modelHints,setModelHints]=useState<Record<string,RecordRow[]>>({});
 const [newCustomer,setNewCustomer]=useState(''),[duplicates,setDuplicates]=useState<RecordRow[]>([]);
 const [saved,setSaved]=useState<RecordRow|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [stale,setStale]=useState(false);
 async function listOrders(q=search,f=filter,next=0){
  try{
   const params=new URLSearchParams({q,filter:f,limit:'25',offset:String(next)});
   const result=await request('/equipment/batches?'+params);
   setOrders(old=>next?[...old,...result.items]:result.items);setOffset(result.next_offset??null);
   setError('');
  }catch(e){setError(String(e));}
 }
 async function openOrder(id:string,mode:'details'|'edit'='details'){
  try{
   const details=await request('/equipment/batches/'+id);
   setSelected(details);setSelectedId(id);setExpanded([]);setCancelIds([]);setReason('');setReasonOther('');
   if(mode==='edit'){
    const b=details.batch;
    setHeader({customer_id:String(b.customer_id),po_number:b.po_number||'',vendor:b.vendor||'',
     requested_by_name:b.requested_by_name||'',expected_date:b.expected_date||'',notes:b.notes||''});
    setLines(details.lines.map((line:RecordRow)=>({
     entry_line_id:line.entry_line_id,equipment_type_id:line.equipment_type_id,
     manufacturer:line.manufacturer||'',model:line.model||'',quantity:Number(line.active),
     manufacturer_unknown:Boolean(line.manufacturer_unknown),model_unknown:Boolean(line.model_unknown)
    })));
   }
   setView(mode);setError('');setStale(false);
  }catch(e){setError(String(e));}
 }
 useEffect(()=>{void listOrders('', 'outstanding',0);},[]);
 useEffect(()=>{if(refreshVersion>0)void listOrders(search,filter,0);},[refreshVersion]);
 useEffect(()=>{if(recoveredOrder)void openOrder(recoveredOrder.batchId);},[recoveredOrder?.sequence]);
 useEffect(()=>{
  if(!customerQuery.trim()){setCustomerMatches([]);return;}
  let active=true;
  const delay=setTimeout(()=>{void request('/customers?q='+encodeURIComponent(customerQuery)).then(r=>{
   if(active)setCustomerMatches(r.items||[]);
  }).catch(e=>{if(active)setError(String(e));});},250);
  return ()=>{active=false;clearTimeout(delay);};
 },[customerQuery]);
 async function loadModelHints(typeId:string){
  if(!typeId||modelHints[typeId])return;
  try{const result=await request('/equipment/models?type_id='+encodeURIComponent(typeId));
   setModelHints(p=>({...p,[typeId]:result.items||[]}));}catch(e){setError(String(e));}
 }
 function newOrder(){
  setHeader(blankHeader(stock,me?.name||''));setLines([blankLine()]);setSaved(null);setCustomerQuery('');setDuplicates([]);
  setView('new');setError('');setNotice('');
 }
 const updateLine=(i:number,update:Partial<Line>)=>setLines(current=>current.map((item,j)=>i===j?{...item,...update}:item));
 const valid=header.customer_id&&lines.length>0&&lines.length<=10&&(view==='edit'||count(lines)>0)&&count(lines)<=25&&
  lines.every(l=>(view==='edit'&&l.entry_line_id&&selected?.lines?.some((x:RecordRow)=>x.entry_line_id===l.entry_line_id&&Number(x.active)===0)&&l.quantity===0)
   ||(required(l)&&Number.isInteger(Number(l.quantity))&&Number(l.quantity)>0&&Number(l.quantity)<=25));
 function validate(){
  if(!valid){setError('Select a customer and equipment type, enter manufacturer/model or mark each missing field Unknown, and keep quantities within 25 units.');return false;}
  setError('');return true;
 }
 function updateHeader(key:keyof Headers,value:string){setHeader(h=>({...h,[key]:value}));}
 async function createCustomer(){
  if(!newCustomer.trim())return;
  try{
   setBusy(true);
   const result=await mutate('customer','/customers','POST',{display_name:newCustomer.trim()});
   await onCustomerAdded();setHeader(h=>({...h,customer_id:result.customer.customer_id}));
   setNotice('Customer created: '+result.customer.display_name);
   setNewCustomer('');setDuplicates([]);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 async function checkDuplicates(){
  if(!newCustomer.trim())return;
  try{
   const result=await request('/customers/duplicates?name='+encodeURIComponent(newCustomer.trim()));
   setDuplicates(result.items);
  }catch(e){setError(String(e));}
 }
 async function saveOrder(){
  if(!validate()||busy)return;
  try{
   setBusy(true);
   const result=await mutate('order','/equipment/orders','POST',{
    header:{...header,expected_date:header.expected_date||null},
    lines:lines.map(l=>({...l,quantity:Number(l.quantity)}))
   });
   setSaved(result);setSelectedId(result.batch_id);setView('saved');setNotice('Order saved.');
   await listOrders(search,filter,0);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 function chooseFilter(value:string){setFilter(value);void listOrders(search,value,0);}
 async function editOrder(){
  if(!selected||!validate()||busy)return;
  const lineChanges=lines.map(l=>({
   ...l,quantity:Number(l.quantity),
   ...(l.entry_line_id?{}:{})
  }));
  const original=selected.lines as RecordRow[];
  const needCancel=original.some(o=>{
   const current=lines.find(l=>l.entry_line_id===o.entry_line_id);
   return current&&current.quantity<Number(o.active);
  });
  if(needCancel&&!reason){setError('Reducing quantities requires a cancellation reason and exact Equipment IDs.');return;}
  if(needCancel&&reason==='Other'&&!reasonOther.trim()){setError('Explain the Other cancellation reason.');return;}
  if(needCancel)for(const o of original){
   const current=lines.find(l=>l.entry_line_id===o.entry_line_id);
   if(!current)continue;
   const reduction=Number(o.active)-Number(current.quantity);
   if(reduction>0){
    const chosen=(o.units as RecordRow[]).filter(u=>cancelIds.includes(u.equipment_id));
    if(chosen.length!==reduction){setError('Select exactly '+reduction+' outstanding Equipment IDs from '+o.type_name+'.');return;}
   }
  }
  if(original.some(o=>!lines.some(l=>l.entry_line_id===o.entry_line_id))){setError('Cancel all outstanding units of a line from the order details, rather than deleting historical records.');return;}
  const changeSummary='Save edits to this equipment order? Existing Equipment IDs are retained; quantity increases create new IDs, and received records require extra permission.';
  if(!window.confirm(changeSummary))return;
  try{
   setBusy(true);
   await mutate('editOrder','/equipment/batches/'+selectedId,'PATCH',{
    version:selected.batch.version,header:{...header,expected_date:header.expected_date||null},
    lines:lineChanges,cancel_unit_ids:cancelIds,reason,explanation:reasonOther
   });
   setNotice('Order changes saved and audited.');await openOrder(selectedId);await listOrders(search,filter,0);
  }catch(e){
   const conflict=e instanceof EquipmentApiError&&e.status===409&&e.code==='version_conflict';
   setStale(conflict);
   setError(conflict?'Another employee changed this order. Your unsaved fields are still visible; review or copy them before loading the latest version.':String(e));
  }finally{setBusy(false);}
 }
 async function cancelOrder(){
  if(!selected)return;
  const outstanding=(selected.units as RecordRow[]).filter(u=>u.status==='ordered');
  const chosen=cancelIds.length?outstanding.filter(u=>cancelIds.includes(u.equipment_id)):outstanding;
  if(!chosen.length){setError('No outstanding units are selected.');return;}
  if(!reason||(reason==='Other'&&!reasonOther.trim())){setError('Select a cancellation reason. Other requires an explanation.');return;}
  if(!window.confirm('Cancel '+chosen.length+' outstanding unit(s)? Their Equipment IDs and history will be preserved.'))return;
  try{
   setBusy(true);
   await mutate('cancelBatch','/equipment/batches/'+selectedId+'/cancel','POST',{version:selected.batch.version,unit_ids:chosen.map(u=>u.equipment_id),reason,explanation:reasonOther});
   setNotice('Cancelled '+chosen.length+' unit(s).');await openOrder(selectedId);await listOrders(search,filter,0);
  }catch(e){
   const conflict=e instanceof EquipmentApiError&&e.status===409&&e.code==='version_conflict';
   setStale(conflict);
   setError(conflict?'Order changed while you were cancelling it. Reload the saved order before attempting another cancellation.':String(e));
  }finally{setBusy(false);}
 }
 const matchingCustomers=customerQuery.trim()?customerMatches:customers;
 const headerFields= <div className="space-y-3">
  <label className="block font-semibold">Customer / STOCK
   <input value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} className={input} placeholder="Search customers"/>
   <select className={input} value={header.customer_id} onChange={e=>updateHeader('customer_id',e.target.value)}>
    {!matchingCustomers.some(c=>c.customer_id===header.customer_id)&&<option value={header.customer_id}>{customers.find(c=>c.customer_id===header.customer_id)?.display_name||'Current customer'}</option>}
    {matchingCustomers.map(c=><option key={c.customer_id} value={c.customer_id}>{c.display_name}</option>)}
   </select>
  </label>
  <div className="grid gap-2 md:grid-cols-2">
   <label>PO (optional)<input className={input} value={header.po_number} onChange={e=>updateHeader('po_number',e.target.value)} placeholder="No PO"/></label>
   <label>Vendor<input className={input} value={header.vendor} onChange={e=>updateHeader('vendor',e.target.value)}/></label>
   <label>Requested by<input className={input} value={header.requested_by_name} onChange={e=>updateHeader('requested_by_name',e.target.value)}/></label>
   <label>Expected arrival<input type="date" className={input} value={header.expected_date} onChange={e=>updateHeader('expected_date',e.target.value)}/></label>
  </div>
  <label className="block">Order notes<textarea className={input} rows={3} value={header.notes} onChange={e=>updateHeader('notes',e.target.value)} placeholder="Optional order details"/></label>
 </div>;
 const lineFields=<div className="space-y-3">
  {lines.map((line,i)=>{
   const historical=view==='edit'&&line.entry_line_id&&selected?.lines?.some((x:RecordRow)=>x.entry_line_id===line.entry_line_id&&Number(x.active)===0);
   return historical?<div key={line.entry_line_id} className="rounded-lg border bg-gray-50 p-3 text-sm">
    <b>Equipment line {i+1} — fully cancelled (history only)</b><p>{types.find(t=>t.equipment_type_id===line.equipment_type_id)?.name} · {line.manufacturer||'Manufacturer unknown'} · {line.model||'Model unknown'}</p><p>Active quantity: 0. Previous Equipment IDs remain in order history.</p>
   </div>:<div key={line.entry_line_id||i} className="rounded-lg border p-3 space-y-2">
   <div className="flex justify-between"><b>Equipment line {i+1}</b>
    {!line.entry_line_id&&lines.length>1&&<button className="underline" onClick={()=>setLines(s=>s.filter((_,j)=>j!==i))}>Remove new line</button>}
   </div>
   <div className="grid gap-2 md:grid-cols-2">
    <label>Equipment type<select className={input} value={line.equipment_type_id} onChange={e=>updateLine(i,{equipment_type_id:e.target.value})}>
      <option value="">Choose type</option>{types.map(t=><option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} — {t.department}</option>)}
     </select></label>
    <label>Quantity<input type="number" min={1} max={25} className={input} value={line.quantity} onChange={e=>updateLine(i,{quantity:Number(e.target.value)})}/></label>
    <div><label className="block" htmlFor={'equipment-manufacturer-'+i}>Manufacturer</label><input id={'equipment-manufacturer-'+i} aria-label="Manufacturer" className={input} list={'equipment-order-manufacturer-hints-'+i} value={line.manufacturer} disabled={line.manufacturer_unknown} onFocus={()=>void loadModelHints(line.equipment_type_id)} onChange={e=>updateLine(i,{manufacturer:e.target.value})}/>
     <datalist id={'equipment-order-manufacturer-hints-'+i}>{[...new Set((modelHints[line.equipment_type_id]||[]).map(m=>String(m.manufacturer||'')).filter(Boolean))].map(m=><option key={m} value={m}/>)}</datalist>
     <label className="flex gap-2 items-center text-sm"><input type="checkbox" aria-label="Unknown manufacturer" checked={line.manufacturer_unknown} onChange={e=>updateLine(i,{manufacturer_unknown:e.target.checked,manufacturer:e.target.checked?'':line.manufacturer})}/> Unknown manufacturer</label>
    </div>
    <div><label className="block" htmlFor={'equipment-model-'+i}>Model</label><input id={'equipment-model-'+i} aria-label="Model" className={input} list={'equipment-order-model-hints-'+i} value={line.model} disabled={line.model_unknown} onFocus={()=>void loadModelHints(line.equipment_type_id)} onChange={e=>updateLine(i,{model:e.target.value})}/>
     <datalist id={'equipment-order-model-hints-'+i}>{(modelHints[line.equipment_type_id]||[]).map((m,j)=><option key={j} value={m.model}>{m.manufacturer}</option>)}</datalist>
     <label className="flex gap-2 items-center text-sm"><input type="checkbox" aria-label="Unknown model" checked={line.model_unknown} onChange={e=>updateLine(i,{model_unknown:e.target.checked,model:e.target.checked?'':line.model})}/> Unknown model</label>
    </div>
   </div>
  </div>})}
  <div className="flex gap-2 flex-wrap">
   <button className={secondary} disabled={lines.length>=10} onClick={()=>setLines(s=>[...s,blankLine()])}>+ Add equipment line</button>
   <span className="py-2 text-sm font-bold">{count(lines)} units</span>
  </div>
 </div>;
 const reasonForm=<div className="rounded-lg border p-3 space-y-2">
  <label className="block font-bold">Cancellation reason
   <select className={input} value={reason} onChange={e=>setReason(e.target.value)}><option value="">Choose reason</option>{reasons.map(x=><option key={x}>{x}</option>)}</select>
  </label>
  {reason==='Other'&&<label className="block">Explanation (required)<input className={input} value={reasonOther} onChange={e=>setReasonOther(e.target.value)}/></label>}
 </div>;
 return <section className="space-y-4">
  <div className="flex flex-wrap justify-between items-center gap-3"><div><h2 className="text-2xl font-bold">Equipment Orders</h2>
   <p className="text-sm text-gray-600">Every equipment unit has its own permanent Equipment ID.</p></div>
   <button className={primary} disabled={!can('order_equipment')} onClick={newOrder}>+ New Order</button>
  </div>
  {error&&<p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">{error}</p>}
  {notice&&<p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3">{notice}</p>}
  {view==='list'&&<div className="space-y-3">
   <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();const next=search.trim()?'all':filter;if(next!==filter)setFilter(next);void listOrders(search,next,0);}}>
    <input className={input+' flex-1'} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search PO, customer, model, manufacturer, vendor, batch, requester"/>
    <button className={primary}>Search all orders</button>
   </form>
   <div className="flex gap-2 flex-wrap">{[['outstanding','Outstanding'],['partial','Partially received'],['closed','Closed'],['all','All']].map(([key,name])=>
    <button key={key} className={filter===key?primary:secondary} onClick={()=>chooseFilter(key)}>{name}</button>)}</div>
   {orders.map(b=><button key={b.entry_batch_id} className="block w-full rounded-lg border bg-white p-3 text-left hover:border-[#6B1A2C]" onClick={()=>void openOrder(b.entry_batch_id)}>
    <div className="flex flex-wrap justify-between gap-2"><b>{b.customer_name} · {b.po_number||'No PO'}</b><span>{b.status}</span></div>
    <p className="text-sm">{b.entry_batch_id} · {displayDate(b.created_at)}{b.vendor?' · '+b.vendor:''}</p>
    <p className="text-sm">{b.equipment_summary||'Equipment'} · {b.remaining} outstanding · {b.received} received · {b.cancelled} cancelled</p>
   </button>)}
   {!orders.length&&<p className="rounded-lg border bg-white p-4">No matching orders.</p>}
   {offset!==null&&<button className={secondary} onClick={()=>void listOrders(search,filter,offset)}>Load more orders</button>}
  </div>}
  {(view==='new'||view==='edit')&&<div className="rounded-xl border bg-white p-4 space-y-4">
   <div className="flex justify-between items-center"><h3 className="text-lg font-bold">{view==='new'?'New Equipment Order':'Edit order '+selectedId}</h3>
    <button className={secondary} onClick={()=>view==='new'?setView('list'):setView('details')}>Back</button></div>
   <h4 className="font-bold">1. Order information</h4>{headerFields}
   {view==='new'&&<details className="border rounded-lg p-3">
    <summary className="cursor-pointer font-semibold">Create a new customer</summary>
    <div className="flex flex-wrap gap-2 pt-2"><input className={input+' flex-1'} value={newCustomer} onChange={e=>setNewCustomer(e.target.value)} placeholder="Customer name"/>
     <button className={secondary} onClick={()=>void checkDuplicates()}>Check duplicates</button>
     <button className={primary} disabled={!newCustomer.trim()||busy} onClick={()=>void createCustomer()}>Create customer</button></div>
    {duplicates.length>0&&<p className="text-sm text-amber-800">Similar names: {duplicates.map(d=>d.display_name).join(', ')}. Verify before creating a duplicate.</p>}
   </details>}
   <h4 className="font-bold">2. Equipment lines</h4>{lineFields}
   {view==='new'?<button className={primary} disabled={!can('order_equipment')||!valid} onClick={()=>{if(validate())setView('review');}}>Review Order</button>:
   <div className="space-y-3">
    <p className="text-sm">Quantity reductions cancel the exact outstanding IDs you select below. Existing unit IDs are never reused.</p>
    {(selected?.lines||[]).map((group:RecordRow)=><details key={group.entry_line_id} className="border rounded p-2"><summary>{group.type_name} · {group.model||'Model unknown'} · {group.active} active units</summary>
     {(group.units as RecordRow[]).filter(u=>u.status==='ordered').map(u=><label key={u.equipment_id} className="flex gap-2 p-1"><input type="checkbox" checked={cancelIds.includes(u.equipment_id)}
      onChange={e=>setCancelIds(x=>e.target.checked?[...x,u.equipment_id]:x.filter(id=>id!==u.equipment_id))}/>
      {u.equipment_id} · outstanding</label>)}</details>)}
    {reasonForm}<button className={primary} disabled={!valid||busy} onClick={()=>void editOrder()}>Save Changes</button>
    {stale&&<button className={secondary} onClick={()=>{if(window.confirm('Reload the latest order? This replaces your unsaved edits.'))void openOrder(selectedId,'edit');}}>Reload latest order</button>}
   </div>}
  </div>}
  {view==='review'&&<div className="rounded-xl border bg-white p-4 space-y-3">
   <h3 className="text-xl font-bold">3. Review Order</h3><p>No equipment is created until you submit.</p>
   <p><b>Customer:</b> {customers.find(c=>c.customer_id===header.customer_id)?.display_name||header.customer_id}</p>
   <p><b>PO:</b> {header.po_number||'No PO'} · <b>Vendor:</b> {header.vendor||'Not entered'}</p>
   <p><b>Requested by:</b> {header.requested_by_name||me?.name} · <b>Expected:</b> {displayDate(header.expected_date)}</p>
   <p><b>Notes:</b> {header.notes||'None'}</p>
   {lines.map((l,i)=><p className="border-b py-2" key={i}>{types.find(t=>t.equipment_type_id===l.equipment_type_id)?.name} · {l.manufacturer||'Manufacturer unknown'} · {l.model||'Model unknown'} · {l.quantity} unit(s)
    {(l.manufacturer_unknown||l.model_unknown)&&<span className="block text-sm text-amber-800">Missing information will be flagged for follow-up.</span>}</p>)}
   <b>Total: {count(lines)} individual equipment IDs</b>
   <div className="flex gap-2"><button className={secondary} onClick={()=>setView('new')}>Back / Edit</button><button className={primary} disabled={busy||!can('order_equipment')} onClick={()=>void saveOrder()}>Submit Order</button></div>
  </div>}
  {view==='saved'&&saved&&<div className="rounded-xl border bg-white p-4 space-y-3">
   <h3 className="text-xl font-bold">Equipment Order Saved</h3>
   <p><b>Batch ID:</b> {saved.batch_id} · <b>Status:</b> Ordered</p>
   <p>{customers.find(c=>c.customer_id===header.customer_id)?.display_name||header.customer_id} · {header.po_number||'No PO'} · {header.vendor||'No vendor entered'}</p>
   <p>{count(lines)} individual equipment units. Each ID is permanent.</p>
   <div className="flex flex-wrap gap-2">
    <button className={primary} onClick={()=>onPrint(saved.unit_ids)}>Print equipment labels</button>
    <button className={secondary} onClick={()=>void openOrder(saved.batch_id)}>View saved order</button>
    <button className={secondary} onClick={newOrder}>Start another order</button>
   </div>
  </div>}
  {view==='details'&&selected&&<div className="rounded-xl border bg-white p-4 space-y-4">
   <button className={secondary} onClick={()=>setView('list')}>Back to Orders</button>
   <div className="flex flex-wrap justify-between gap-2"><div><h3 className="text-xl font-bold">{selected.batch.customer_name} · {selected.batch.po_number||'No PO'}</h3>
    <p className="text-sm">{selectedId} · {selected.status} · Created {displayDate(selected.batch.created_at)} by {selected.batch.entered_by_email}</p>
    <p className="text-sm">Vendor {selected.batch.vendor||'—'} · Requested by {selected.batch.requested_by_name||'—'} · Expected {displayDate(selected.batch.expected_date)}</p>
    <p className="text-sm">Notes: {selected.batch.notes||'None'}</p></div>
    {can('order_equipment')&&<button className={primary} onClick={()=>void openOrder(selectedId,'edit')}>Edit Order</button>}</div>
   <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[['Total records',selected.total],['Outstanding',selected.remaining],['Received',selected.received],['Cancelled',selected.cancelled]].map(([name,val])=>
    <div key={String(name)} className="border rounded p-2"><b className="block text-xl">{val}</b><span className="text-sm">{name}</span></div>)}</div>
   {(selected.missing as RecordRow[]).length>0&&<p className="rounded border border-amber-400 bg-amber-50 p-3">Missing manufacturer/model information on {(selected.missing as RecordRow[]).length} unit issue(s). Correct it before or during receiving.</p>}
   <h4 className="font-bold">Equipment lines</h4>
   {selected.lines.map((group:RecordRow)=><div key={group.entry_line_id} className="border rounded-lg">
    <button className="flex w-full justify-between p-3 text-left" onClick={()=>setExpanded(x=>x.includes(group.entry_line_id)?x.filter(y=>y!==group.entry_line_id):[...x,group.entry_line_id])}>
     <span><b>{group.type_name}</b> · {group.manufacturer||'Manufacturer unknown'} · {group.model||'Model unknown'}
      <span className="block text-sm">Ordered {group.ordered_qty} · Outstanding {group.remaining} · Received {group.received} · Cancelled {group.cancelled}</span></span>
     <span>{expanded.includes(group.entry_line_id)?'−':'+'}</span>
    </button>
    {expanded.includes(group.entry_line_id)&&<div className="border-t p-3 space-y-2">
     {group.units.map((u:RecordRow)=><div key={u.equipment_id} className="flex flex-wrap justify-between items-center gap-2 border-b pb-2">
      <label className="flex gap-2 items-start"><input type="checkbox" disabled={u.status!=='ordered'||!can('order_equipment')} checked={cancelIds.includes(u.equipment_id)}
       onChange={e=>setCancelIds(x=>e.target.checked?[...x,u.equipment_id]:x.filter(id=>id!==u.equipment_id))}/>
       <span><b>{u.equipment_id}</b> · {u.status}<span className="block text-sm">Serial {u.serial_number||'Not entered'} · Location {u.location_note||'—'} · Printed {Number(u.printed_count)>0?'Yes':'No'}{u.cancel_reason?' · Cancelled: '+u.cancel_reason:''}</span></span>
      </label>
      <div className="flex gap-2"><a className="underline text-[#6B1A2C]" href={'/equipment/?id='+encodeURIComponent(u.equipment_id)}>Open</a>
       {u.status==='ordered'&&<button className="underline" onClick={()=>onReceive(selectedId)}>Receive</button>}
       {u.status!=='cancelled'&&<button className="underline" onClick={()=>onPrint([u.equipment_id])}>Label</button>}
       {u.marker_x_in!=null&&<a className="underline" href={'/map/?equipment='+encodeURIComponent(u.equipment_id)}>Map</a>}</div>
     </div>)}
    </div>}
   </div>)}
   <div className="flex flex-wrap gap-2"><button className={secondary} onClick={()=>onReceive(selectedId)}>Go to receiving</button>
    <button className={secondary} onClick={()=>onPrint((selected.units as RecordRow[]).filter(u=>u.status!=='cancelled').map(u=>u.equipment_id).slice(0,25))}>Print order labels</button></div>
   {can('order_equipment')&&selected.remaining>0&&<div className="space-y-2 rounded-lg border p-3">
    <h4 className="font-bold">Cancel outstanding equipment</h4>
    <p className="text-sm">{cancelIds.length?cancelIds.length+' selected outstanding units':'No selection — cancel all remaining outstanding units'}.</p>
    {reasonForm}<button className={primary} disabled={busy} onClick={()=>void cancelOrder()}>Cancel {cancelIds.length||selected.remaining} outstanding unit(s)</button>
   </div>}
   <details className="border rounded-lg p-3"><summary className="cursor-pointer font-bold">Activity History ({selected.history.length})</summary>
    <div className="max-h-80 overflow-auto space-y-2 pt-2">{selected.history.map((event:RecordRow)=><div className="border-b pb-2 text-sm" key={event.event_id}>
     <b>{event.action}</b> · {event.by} · {event.at}<p className="break-all">{JSON.stringify(parseJSON(event.after))}</p>
    </div>)}</div>
   </details>
  </div>}
 </section>;
}
