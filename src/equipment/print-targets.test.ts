import { describe, expect, it } from 'vitest';
import { explicitLabelTargetIds, printableOrderEquipmentIds, printableInventoryEquipmentIds, hasUnconfirmedPrintJob } from './print-targets';

const first='eqp-22222222';
const second='eqp-33333333';
const stale='eqp-44444444';

describe('explicit equipment print targets',()=>{
 it('does not fall back from an empty order target to previous equipment',()=>{
  const previous=[stale];
  expect(explicitLabelTargetIds([])).toBeNull();
  expect(previous).toEqual([stale]);
 });
 it('a fully cancelled order has no targets',()=>{
  expect(printableOrderEquipmentIds([{equipment_id:second,status:'cancelled'}])).toEqual([]);
 });
 it('partially cancelled orders include only their own eligible units',()=>{
  const fromOrderB=printableOrderEquipmentIds([
   {equipment_id:first,status:'ordered'},
   {equipment_id:second,status:'cancelled'}
  ]);
  expect(explicitLabelTargetIds(fromOrderB)).toEqual([first]);
  expect(fromOrderB).not.toContain(stale);
 });
 it('single-record and inventory targets are kept exactly as selected',()=>{
  expect(explicitLabelTargetIds([second])).toEqual([second]);
  expect(explicitLabelTargetIds([first,second])).toEqual([first,second]);
 });
 it('rejects duplicate, invalid and excessive explicit requests',()=>{
  expect(explicitLabelTargetIds([first,first])).toBeNull();
  expect(explicitLabelTargetIds(['not-an-equipment-id'])).toBeNull();
  expect(explicitLabelTargetIds(Array.from({length:26},()=>first))).toBeNull();
 });
 it('excludes cancelled and no-longer-visible inventory units, including stale selections',()=>{
  const current=[{equipment_id:first,status:'received'},{equipment_id:second,status:'cancelled'}];
  expect(printableInventoryEquipmentIds([stale,second,first],current)).toEqual([first]);
  expect(printableInventoryEquipmentIds([second],current)).toEqual([]);
  expect(printableInventoryEquipmentIds([first],[])).toEqual([]);
 });
 it('fails closed for malformed API rows, unknown states and invalid IDs',()=>{
  const valid={equipment_id:first,status:'ordered'};
  const rows:unknown[]=[null,42,'not-a-row',{},
   {equipment_id:'bad-id',status:'ordered'},
   {equipment_id:stale,status:'cancelled'},
   {equipment_id:second,status:'unrecognized'},
   {equipment_id:second},valid,valid];
  expect(printableOrderEquipmentIds(rows)).toEqual([first]);
  expect(printableInventoryEquipmentIds([second,stale,first,first],rows)).toEqual([first]);
  expect(explicitLabelTargetIds([first,undefined])).toBeNull();
  expect(explicitLabelTargetIds([first,null])).toBeNull();
 });
 it('preserves all current eligible statuses but rejects cancelled units',()=>{
  const statuses=['ordered','received','in_stock','reserved','installed','delivered','returned'];
  expect(printableOrderEquipmentIds(statuses.map(status=>({equipment_id:first,status})))).toEqual([first]);
  expect(printableOrderEquipmentIds([{equipment_id:first,status:'cancelled'}])).toEqual([]);
 });
 it('caps a print order at 25 unique validated IDs',()=>{
  // IDs are 8 characters in the canonical alphabet.
  const ids=Array.from({length:26},(_,i)=>'eqp-2222222'+'23456789abcdefghjkmnpqrstuvwxyz'[i]);
  const all=ids.map(equipment_id=>({equipment_id,status:'received'}));
  expect(printableOrderEquipmentIds(all)).toHaveLength(25);
 });
 it('identifies prepared but unconfirmed receipts without confusing them with draft selections',()=>{
  expect(hasUnconfirmedPrintJob([])).toBe(false);
  expect(hasUnconfirmedPrintJob(['elp-22222222'])).toBe(true);
  expect(hasUnconfirmedPrintJob(['elp-22222222','elp-33333333'])).toBe(true);
  // A draft order or selected inventory unit is not itself a prepared print receipt.
  expect(hasUnconfirmedPrintJob([])).toBe(false);
 });
 it('does not implicitly recover an earlier print target after a tab change',()=>{
  const orderA=explicitLabelTargetIds([first]);
  expect(orderA).toEqual([first]);
  const nextDraft:string[]=[]; // Tab navigation invalidates this draft, not a prepared PDF receipt.
  expect(explicitLabelTargetIds(nextDraft)).toBeNull();
  const fullyCancelledOrderB=printableOrderEquipmentIds([{equipment_id:second,status:'cancelled'}]);
  expect(fullyCancelledOrderB).toEqual([]);
  expect(explicitLabelTargetIds(fullyCancelledOrderB)).toBeNull();
 });
});
