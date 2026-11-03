import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { rig } from "./CameraRig";
import { isEquipmentId } from "../../shared/ids";

type EquipmentMarker={equipment_id:string;marker_x_in:number;marker_y_in:number;status:string;po_number:string;customer_name:string;type_name:string;ordered_model:string;version:number};
let pendingId: string | null = null;
export const pendingEquipmentPlacement=()=>pendingId;

async function json(url:string,options?:RequestInit):Promise<Record<string,unknown>>{
  const res=await fetch(url,{credentials:"same-origin",...options});
  const data=await res.json() as Record<string,unknown>;
  if(!res.ok)throw new Error(String(data.message??"Equipment map request failed"));
  return data;
}
export async function placeEquipmentAt(x:number,y:number){
  if(!pendingId)return;
  const equipmentId=pendingId;
  const record=await json("/api/equipment/"+equipmentId);
  const unit=record.unit as {version:number};
  await json("/api/equipment/"+equipmentId+"/place",{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify({version:unit.version,x_in:x,y_in:y})
  });
  pendingId=null;
  window.dispatchEvent(new Event("equipment-markers-changed"));
}
export function EquipmentMarkers(){
  const [markers,setMarkers]=useState<EquipmentMarker[]>([]);
  const invalidate=useThree(s=>s.invalidate);
  useEffect(()=>{
    let alive=true;
    const refresh=()=>{void json("/api/equipment/map-markers").then(data=>{
      if(alive){
        const items=data.items as EquipmentMarker[];
        setMarkers(items);
        const wanted=new URLSearchParams(window.location.search).get("equipment");
        const focus=items.find(item=>item.equipment_id===wanted);
        if(focus)rig.pendingTarget=new THREE.Vector3(focus.marker_x_in,0,focus.marker_y_in);
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
      onClick={e=>{e.stopPropagation();window.location.href="/equipment/?id="+encodeURIComponent(m.equipment_id);}}>
      <sphereGeometry args={[9,12,12]}/>
      <meshStandardMaterial color="#C9A84C" emissive="#6B1A2C" emissiveIntensity={0.25}/>
    </mesh>)}</group>;
}
export function EquipmentMapPanel(){
  const [id,setId]=useState("");
  const [canPlace,setCanPlace]=useState(false);
  const [active,setActive]=useState(false);
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
        onClick={()=>{pendingId=id.trim().toLowerCase();setActive(true);}}>Place this equipment</button>
      {active&&<p className="mt-1 text-sm font-semibold">Click the equipment's exact warehouse floor location.</p>}
      {active&&<button type="button" className="ml-2 underline" onClick={()=>{pendingId=null;setActive(false);}}>Cancel placement</button>}
    </details>
  </div>;
}
