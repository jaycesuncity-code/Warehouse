import { isEquipmentId } from '../shared/ids';

/** The API returns dynamic rows. Never trust a row's ID or status until checked. */
export type PrintableEquipment = {equipment_id:string;status:string};

// Cancelled and unrecognized states are not valid print targets. Every current
// non-cancelled equipment status is explicitly listed here.
const printableStatuses=new Set(['ordered','received','in_stock','reserved','installed','delivered','returned']);

function printableEquipment(value:unknown):PrintableEquipment|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 return isEquipmentId(row.equipment_id)&&typeof row.status==='string'&&printableStatuses.has(row.status)
  ?{equipment_id:row.equipment_id,status:row.status}:null;
}

/** A batch can contain historical cancelled and malformed units. Fail closed for
 * individual records while retaining only up to 25 distinct eligible IDs. */
export function printableOrderEquipmentIds(units:readonly unknown[]):string[] {
 const ids:string[]=[],seen=new Set<string>();
 for(const value of units){
  const unit=printableEquipment(value);
  if(!unit||seen.has(unit.equipment_id))continue;
  seen.add(unit.equipment_id);ids.push(unit.equipment_id);
  if(ids.length===25)break;
 }
 return ids;
}

/** No fallback to an old order, scanner record or previous inventory selection. */
export function explicitLabelTargetIds(ids:readonly unknown[]):string[]|null {
 if(ids.length<1||ids.length>25)return null;
 const targets:string[]=[],seen=new Set<string>();
 for(const id of ids){
  if(!isEquipmentId(id)||seen.has(id))return null;
  seen.add(id);targets.push(id);
 }
 return targets;
}

/** Inventory checkboxes can outlive a refresh or a cancellation. Only eligible
 * units in the currently loaded result can be submitted, in the user's order. */
export function printableInventoryEquipmentIds(ids:readonly string[],units:readonly unknown[]):string[] {
 const eligible=new Set<string>();
 for(const value of units){const unit=printableEquipment(value);if(unit)eligible.add(unit.equipment_id);}
 const seen=new Set<string>(),targets:string[]=[];
 for(const id of ids){
  if(eligible.has(id)&&!seen.has(id)){seen.add(id);targets.push(id);}
 }
 return targets;
}

/** Prepared print IDs are cleared only after confirmation or an accepted discard. */
export function hasUnconfirmedPrintJob(preparedPrintIds:readonly string[]):boolean {
 return preparedPrintIds.length>0;
}
