import { useEffect, useState } from 'react';
type Staff = {email:string;display_name:string;active:number;permission:string|null};
const grants=['order_equipment','receive_edit_equipment','print_labels','manage_equipment_types','manage_staff'] as const;
const field='rounded-lg border px-3 py-2 w-full';
const primary='rounded-lg bg-[#6B1A2C] text-white font-semibold px-4 py-2 disabled:opacity-50';
export function StaffPanel(){
 const [rows,setRows]=useState<Staff[]>([]),[email,setEmail]=useState(''),[permission,setPermission]=useState<string>(grants[0]),
   [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{
  const res=await fetch('/api/staff',{credentials:'same-origin'});
  const data=await res.json() as {items:Staff[],message?:string};
  if(!res.ok)throw new Error(data.message||'Cannot retrieve staff permissions');
  setRows(data.items);
 };
 useEffect(()=>{load().catch(e=>setMessage(String(e)));},[]);
 const change=async(method:'PUT'|'DELETE',who:string,what:string)=>{
  setBusy(true);setMessage('');
  try{
   const res=await fetch('/api/staff/'+encodeURIComponent(who.trim().toLowerCase())+'/permissions/'+encodeURIComponent(what),
    {method,credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:'{}'});
   const data=await res.json() as {message?:string};
   if(!res.ok)throw new Error(data.message||'Permission change failed');
   await load();setMessage(method==='PUT'?'Permission granted.':'Permission revoked.');
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const grouped=new Map<string,Staff[]>();
 for(const row of rows)grouped.set(row.email,[...(grouped.get(row.email)||[]),row]);
 return <section className="bg-white border rounded-xl p-4 space-y-4">
  <h2 className="text-xl font-bold">Staff equipment permissions</h2>
  <p className="text-sm">Verified Cloudflare Access email controls identity. Only equipment permissions are managed here. Legacy parts, map and packouts still use editor/admin role allowlists. Administrator grants require the legacy admin allowlist.</p>
  <div className="grid md:grid-cols-3 gap-3">
   <label>Email<input className={field} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="employee@company.com"/></label>
   <label>Permission<select className={field} value={permission} onChange={e=>setPermission(e.target.value)}>{grants.map(g=><option key={g} value={g}>{g}</option>)}</select></label>
   <button className={primary} disabled={busy||!email.includes('@')} onClick={()=>change('PUT',email,permission)}>Grant permission</button>
  </div>
  {message&&<p role="status" className="p-2 bg-yellow-50 rounded-lg">{message}</p>}
  <div className="space-y-3">
   {[...grouped.entries()].map(([who,list])=><article className="border rounded-lg p-3" key={who}>
     <p className="font-semibold">{who}</p>
     <div className="flex flex-wrap gap-2 my-2">{list.filter(x=>x.permission).map(p=><button className="border rounded-lg px-2 py-1 text-sm bg-gray-50" disabled={busy} onClick={()=>change('DELETE',who,p.permission!)} key={p.permission}>{p.permission} ×</button>)}</div>
   </article>)}
  </div>
 </section>;
}
