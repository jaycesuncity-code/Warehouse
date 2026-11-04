import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { flyTo, getMap, setMap, toast } from "../store";
import { browserEquipmentStore, EquipmentApiError, createMutation, performMutation, readPendingMutation, type PendingMutation } from "../../equipment/recoverable";
import { isEquipmentId } from "../../shared/ids";

type EquipmentMarker={equipment_id:string;marker_x_in:number;marker_y_in:number;status:string;po_number:string;customer_name:string;type_name:string;ordered_model:string;version:number};
let pendingId: string | null = null;
let placementLock=false;
export const pendingEquipmentPlacement=()=>pendingId;
const notifyPlacement=()=>window.dispatchEvent(new Event("equipment-placement-state"));

async function json(url:string,options?:RequestInit):Promise<Record<string,unknown>>{
  const res=await fetch(url,{credentials:"same-origin",...options});
  let data:Record<string,unknown>;
  try{data=await res.json() as Record<string,unknown>;}catch{
    if(res.status===401||res.status===403)throw new EquipmentApiError(res.status,'forbidden','You are not authorized to place equipment.');
    throw new Error('The warehouse returned an invalid equipment map response.');
  }
  if(!res.ok)throw new EquipmentApiError(res.status,String(data.error??"request_failed"),String(data.message??"Equipment map request failed"));
  return data;
}
async function sendPlacement(attempt:PendingMutation,recovery=false){
  if(placementLock)throw new Error('Equipment position is already saving.');
  placementLock=true;
  try{
    await performMutation(browserEquipmentStore,attempt,saved=>json('/api'+saved.path,{
      method:saved.method,headers:{'Content-Type':'application/json','Idempotency-Key':saved.key},
      body:JSON.stringify(saved.body)
    }),recovery);
    pendingId=null;
    window.dispatchEvent(new Event('equipment-markers-changed'));
    toast('Equipment map position saved to D1.','success');
  }finally{
    placementLock=false;
    notifyPlacement();
  }
}
export async function placeEquipmentAt(x:number,y:number){
  if(!pendingId)return;
  if(readPendingMutation(browserEquipmentStore))throw new Error('A prior equipment change needs recovery before another placement.');
  const equipmentId=pendingId;
  const record=await json('/api/equipment/'+equipmentId);
  const unit=record.unit as {version:number};
  const attempt=createMutation('place','/equipment/'+equipmentId+'/place','POST',{
    version:unit.version,x_in:x,y_in:y
  });
  await sendPlacement(attempt);
}
export async function recoverEquipmentPlacement(){
  const attempt=readPendingMutation(browserEquipmentStore);
  if(!attempt||attempt.kind!=='place')throw new Error('No equipment placement to recover.');
  await sendPlacement(attempt,true);
}
export function EquipmentMarkers(){
  const [markers,setMarkers]=useState<EquipmentMarker[]>([]);
  const invalidate=useThree(s=>s.invalidate);
  const lastFocused=useRef('');
  const wanted=new URLSearchParams(window.location.search).get('equipment');
  useEffect(()=>{
    let alive=true;
    const refresh=()=>{void json("/api/equipment/map-markers").then(data=>{
      if(alive){
        const items=data.items as EquipmentMarker[];
        setMarkers(items);
        const targetId=new URLSearchParams(window.location.search).get('equipment');
        if(targetId){
          const focus=items.find(item=>item.equipment_id===targetId);
          const key=focus?focus.equipment_id+':'+focus.marker_x_in+':'+focus.marker_y_in:'missing:'+targetId;
          if(lastFocused.current!==key){
            lastFocused.current=key;
            if(focus){
              if(getMap().view==='walk')setMap({view:'plan'});
              flyTo({center:{x:focus.marker_x_in,y:focus.marker_y_in,h:11},radius:90});
              toast('Equipment '+focus.equipment_id+' highlighted on the warehouse map.','info');
            }else toast('No saved warehouse map marker exists for equipment '+targetId+'.','warn');
          }
        }
        invalidate();
      }
    }).catch(()=>{if(alive)setMarkers([]);});};
    refresh();
    window.addEventListener("equipment-markers-changed",refresh);
    return()=>{alive=false;window.removeEventListener("equipment-markers-changed",refresh);};
  },[invalidate]);
  return <group name="equipment-markers">{markers.map(m=>
    <mesh key={m.equipment_id} name={"equipment:"+m.equipment_id}
      position={[m.marker_x_in,11,m.marker_y_in]}
      scale={m.equipment_id===wanted?[1.8,1.8,1.8]:[1,1,1]}
      onClick={e=>{e.stopPropagation();if(pendingEquipmentPlacement()){
        toast('Choose an open floor position to stage equipment; click markers only to view details outside placement mode.','warn');
        return;
      }window.location.href="/equipment/?id="+encodeURIComponent(m.equipment_id);}}>
      <sphereGeometry args={[9,12,12]}/>
      <meshStandardMaterial color={m.equipment_id===wanted?'#FFE177':'#C9A84C'} emissive="#6B1A2C" emissiveIntensity={m.equipment_id===wanted?0.9:0.25}/>
    </mesh>)}</group>;
}
export function EquipmentMapPanel(){
  const [id,setId]=useState("");
  const [canPlace,setCanPlace]=useState(false);
  const [active,setActive]=useState(false);
  const [pendingPlace,setPendingPlace]=useState<PendingMutation|null>(()=>{
    const p=readPendingMutation(browserEquipmentStore);return p?.kind==='place'?p:null;
  });
  useEffect(()=>{
    const sync=()=>{
      const p=readPendingMutation(browserEquipmentStore);
      setPendingPlace(p?.kind==='place'?p:null);
      if(!pendingEquipmentPlacement())setActive(false);
    };
    window.addEventListener('equipment-placement-state',sync);
    return()=>window.removeEventListener('equipment-placement-state',sync);
  },[]);
  useEffect(()=>{let ok=true;void json("/api/me").then(m=>{const p=m.permissions as string[]|undefined;
    if(ok)setCanPlace(!!p&&(p.includes("receive_edit_equipment")||p.includes("admin")));}).catch(()=>{});
    return()=>{ok=false;};},[]);
  if(!canPlace)return null;
  return <div className="absolute bottom-3 left-3 z-30 max-w-[min(24rem,calc(100%-1.5rem))] rounded-lg border border-gold bg-white/95 p-3 shadow-lg">
    <details><summary className="cursor-pointer font-bold">Equipment staging markers</summary>
      <p className="mt-2 text-xs">Enter a saved equipment ID, select Place, then click its physical spot on the map. The position saves to D1 after server validation.</p>
      <input aria-label="Equipment ID to stage" value={id} onChange={e=>setId(e.target.value)} placeholder="eqp-xxxxxxxx" className="mt-2 w-full rounded border p-2"/>
      <button type="button" className="mt-2 rounded bg-maroon px-3 py-2 font-bold text-white disabled:opacity-50"
        disabled={!isEquipmentId(id.trim().toLowerCase())}
        onClick={()=>{
          if(readPendingMutation(browserEquipmentStore)){
            toast('Recover the earlier equipment change before starting another placement.','warn');return;
          }
          pendingId=id.trim().toLowerCase();setActive(true);
          if(getMap().view==='walk')setMap({view:'plan'});
        }}>Place this equipment</button>
      {active&&<p className="mt-1 text-sm font-semibold">Click an open warehouse floor location to save this unit's position.</p>}
      {active&&<button type="button" className="ml-2 underline" onClick={()=>{pendingId=null;setActive(false);}}>Cancel placement</button>}
      {pendingPlace&&<div role="alert" className="mt-2 rounded border border-amber-500 bg-amber-50 p-2">
        <p>Last placement result is uncertain. Recover the original coordinate/version request before placing another marker.</p>
        <button type="button" className="underline font-semibold" onClick={()=>void recoverEquipmentPlacement().catch(e=>toast(e instanceof Error?e.message:String(e),'error'))}>Recover previous placement</button>
      </div>}
    </details>
  </div>;
}
