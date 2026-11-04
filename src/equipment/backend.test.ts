import { beforeEach, describe, expect, it } from 'vitest';
import { TestDatabase } from '../shared/testing/database';
import { equipmentRoute, permissions } from '../../functions/lib/equipment';
import type { Me } from '../shared/contract';

const admin:Me = {email:'admin@example.com',name:'Administrator',role:'admin'};
const viewer:Me = {email:'view@example.com',name:'Viewer',role:'viewer'};
const origin='https://warehouse.example.test';
let db:TestDatabase;
const call=async (path:string,method='GET',data?:object,key?:string,actor=admin) => {
 const body=data?JSON.stringify(data):undefined;
 const request=new Request(origin+'/api'+path,{method,headers:body?{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})}:{},body});
 const response=await equipmentRoute(request,db,actor,await permissions(db,actor));
 expect(response).not.toBeNull();
 return {status:response!.status,body:await response!.json() as Record<string,unknown>};
};
const stockCustomer='cus-stk22222',furnace='ety-22222222';
beforeEach(()=>{db=new TestDatabase();});
describe('scoped D1 equipment workflows',()=>{
 it('seeds equipment types and protected STOCK customer without changing parts',async()=>{
  const types=await call('/equipment/types');
  const customers=await call('/customers');
  expect(types.status).toBe(200);
  expect((types.body.items as unknown[]).length).toBeGreaterThan(0);
  expect((customers.body.items as unknown[]).some((row:unknown)=>(row as {is_stock:number}).is_stock===1)).toBe(true);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM parts').get()).toEqual({n:0});
 });
 it('creates 10 individually identified units in one atomic order, preserving leading zeros',async()=>{
  const result=await call('/equipment/orders','POST',{
   header:{customer_id:stockCustomer,po_number:'004471',requested_by_name:'Jordan'},
   lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'24ABC',quantity:10}]
  },'order-10-uuid');
  expect(result.status).toBe(201);
  const ids=(result.body.unit_ids as string[]);
  expect(ids).toHaveLength(10);
  expect(new Set(ids).size).toBe(10);
  expect(ids.every(x=>x.startsWith('eqp-'))).toBe(true);
  const rows=db.sqlite.prepare('SELECT status,po_number FROM equipment').all() as {status:string,po_number:string}[];
  expect(rows).toHaveLength(10);
  expect(rows.every(r=>r.status==='ordered'&&r.po_number==='004471')).toBe(true);
  expect(db.sqlite.prepare('SELECT count(*) AS n FROM stock').get()).toEqual({n:0});
 });
 it('retries identical order using same receipt without creating duplicates',async()=>{
  const payload={header:{customer_id:stockCustomer,po_number:'123'},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:2}]};
  const a=await call('/equipment/orders','POST',payload,'same-key-123');
  const b=await call('/equipment/orders','POST',payload,'same-key-123');
  expect(a.status).toBe(201);expect(b.status).toBe(201);
  expect(a.body.unit_ids).toEqual(b.body.unit_ids);
  expect(db.sqlite.prepare('SELECT count(*) AS n FROM equipment').get()).toEqual({n:2});
 });
 it('blocks view-only order and receiving mutations',async()=>{
  const res=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:1}]},undefined,viewer);
  expect(res.status).toBe(403);
 });
 it('receives a unit with model mismatch and duplicate serial without blocking either save',async()=>{
  const res=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'ORIGINAL',quantity:2}]});
  const ids=res.body.unit_ids as string[];
  const first=await call('/equipment/'+ids[0]+'/receive','POST',{version:1,serial_number:'S-100',confirmed_model:'DIFFERENT'});
  expect(first.status).toBe(200);
  const duplicate=await call('/equipment/'+ids[1]+'/receive','POST',{version:1,serial_number:'S-100',confirmed_model:'ORIGINAL'});
  expect(duplicate.status).toBe(200);
  const reviews=await call('/equipment/reviews');
  const issues=(reviews.body.items as {issue_code:string}[]).map(r=>r.issue_code);
  expect(issues).toContain('MODEL_MISMATCH');
  expect(issues).toContain('DUPLICATE_SERIAL');
  const stale=await call('/equipment/'+ids[0]+'/receive','POST',{version:1,serial_number:'S-101'});
  expect(stale.status).toBe(409);
 });
 it('prepares eight-up physical labels and confirms independently from equipment stock',async()=>{
  const res=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:9}]});
  const ids=res.body.unit_ids as string[];
  const prepared=await call('/equipment/labels/prepare','POST',{equipment_ids:ids,skip_first_positions:2});
  expect(prepared.status).toBe(200);
  const labels=prepared.body.labels as {label_print_id:string,page_number:number,sheet_position:number}[];
  expect(labels).toHaveLength(9);
  expect(labels[0].sheet_position).toBe(3);
  expect(labels[6].page_number).toBe(2);
  const confirmed=await call('/equipment/labels/confirm','POST',{prepared_print_ids:labels.map(x=>x.label_print_id)});
  expect(confirmed.status).toBe(200);
  expect(db.sqlite.prepare('SELECT count(*) AS n FROM stock').get()).toEqual({n:0});
 });

 it('rejects an idempotency key reused with a changed order',async()=>{
  const first=await call('/equipment/orders','POST',
    {header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:1}]},'changed-order-0001');
  const second=await call('/equipment/orders','POST',
    {header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:3}]},'changed-order-0001');
  expect(first.status).toBe(201);
  expect(second.status).toBe(409);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS total FROM equipment').get()).toEqual({total:1});
 });

 it('places equipment at a verified map coordinate, rejects outside rooms and records an event',async()=>{
  const res=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:1}]});
  const unitId=(res.body.unit_ids as string[])[0];
  expect((await call('/equipment/'+unitId+'/place','POST',{version:1,x_in:120,y_in:500})).status).toBe(200);
  const markers=await call('/equipment/map-markers');
  expect((markers.body.items as {equipment_id:string}[]).some(x=>x.equipment_id===unitId)).toBe(true);
  expect((await call('/equipment/'+unitId+'/place','POST',{version:2,x_in:3000,y_in:3000})).status).toBe(400);
  const history=db.sqlite.prepare("SELECT COUNT(*) AS total FROM events WHERE entity='equipment' AND action='place'").get() as {total:number};
  expect(history.total).toBe(1);
 });

 it('rejects edits to shared order fields via an individual unit',async()=>{
  const order=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer,po_number:'REMOVEME'},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:1}]});
  const equipmentId=(order.body.unit_ids as string[])[0];
  const blocked=await call('/equipment/'+equipmentId,'PATCH',{version:1,changes:{po_number:'new'}});
  expect(blocked.status).toBe(400);
  expect(db.sqlite.prepare('SELECT po_number FROM equipment WHERE equipment_id=?').get(equipmentId)).toEqual({po_number:'REMOVEME'});
 });
 it('does not duplicate an unregistered receipt after a lost response and a same-key retry',async()=>{
  const body={customer_id:stockCustomer,equipment_type_id:furnace,model:'Test fan coil',serial_number:'SER-42',po_number:'00042'};
  const first=await call('/equipment/receive-unregistered','POST',body,'unregistered-retry-42');
  const retry=await call('/equipment/receive-unregistered','POST',body,'unregistered-retry-42');
  expect(first.status).toBe(201);
  expect(retry.status).toBe(201);
  expect((retry.body.unit as {equipment_id:string}).equipment_id).toBe((first.body.unit as {equipment_id:string}).equipment_id);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM equipment').get()).toEqual({n:1});
  const mismatch=await call('/equipment/receive-unregistered','POST',{...body,model:'Different model'},'unregistered-retry-42');
  expect(mismatch.status).toBe(409);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM equipment').get()).toEqual({n:1});
 });

 it('replays customer creation with its original ID, but does not silently collapse legitimate name matches',async()=>{
  const first=await call('/customers','POST',{display_name:'Smith Residence'},'customer-save-42');
  const retry=await call('/customers','POST',{display_name:'Smith Residence'},'customer-save-42');
  expect(first.status).toBe(201);
  expect(retry.body.customer).toEqual(first.body.customer);
  expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM customers WHERE display_name='Smith Residence'").get()).toEqual({n:1});
  const intentional=await call('/customers','POST',{display_name:'Smith Residence'},'customer-save-43');
  expect(intentional.status).toBe(201);
  expect((intentional.body.customer as {customer_id:string}).customer_id).not.toBe((first.body.customer as {customer_id:string}).customer_id);
  expect((intentional.body.similar_customers as unknown[]).length).toBeGreaterThan(0);
 });

 it('returns the same label preparation and print-confirmation receipts when responses are lost',async()=>{
  const ordered=await call('/equipment/orders','POST',{
   header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:2}]
  },'labels-order-42');
  const request={equipment_ids:ordered.body.unit_ids as string[],skip_first_positions:3};
  const a=await call('/equipment/labels/prepare','POST',request,'prepare-labels-42');
  const b=await call('/equipment/labels/prepare','POST',request,'prepare-labels-42');
  expect(a.status).toBe(200);
  expect(b.body.labels).toEqual(a.body.labels);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM equipment_label_prints').get()).toEqual({n:2});
  const prepared_print_ids=(a.body.labels as {label_print_id:string}[]).map(l=>l.label_print_id);
  const confirmed=await call('/equipment/labels/confirm','POST',{prepared_print_ids},'confirm-labels-42');
  const replay=await call('/equipment/labels/confirm','POST',{prepared_print_ids},'confirm-labels-42');
  expect(confirmed.status).toBe(200);
  expect(replay.body).toEqual(confirmed.body);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM equipment_label_prints WHERE confirmed_printed_at IS NOT NULL').get()).toEqual({n:2});
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM stock').get()).toEqual({n:0});
 });

 it('replays marker placement without changing version twice and rejects stale placement',async()=>{
  const order=await call('/equipment/orders','POST',{
   header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer:'Carrier',model:'M',quantity:1}]
  },'map-order-42');
  const equipmentId=(order.body.unit_ids as string[])[0];
  const body={version:1,x_in:120,y_in:500};
  const placed=await call('/equipment/'+equipmentId+'/place','POST',body,'map-place-key-42');
  const again=await call('/equipment/'+equipmentId+'/place','POST',body,'map-place-key-42');
  expect(placed.status).toBe(200);
  expect(again.body).toEqual(placed.body);
  const current=await call('/equipment/'+equipmentId);
  expect((current.body.unit as {version:number}).version).toBe(2);
  expect((await call('/equipment/'+equipmentId+'/place','POST',{version:1,x_in:121,y_in:501},'map-place-key-43')).status).toBe(409);
  const markers=await call('/equipment/map-markers');
  expect((markers.body.items as {equipment_id:string;marker_x_in:number;marker_y_in:number}[])
   .some(marker=>marker.equipment_id===equipmentId&&marker.marker_x_in===120&&marker.marker_y_in===500)).toBe(true);
  expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE action='place' AND entity='equipment'").get()).toEqual({n:1});
 });
});

describe('equipment order management',()=>{
 const line=(quantity=2)=>({equipment_type_id:furnace,manufacturer:'Carrier',model:'ABC',quantity});
 it('requires explicit Unknown acknowledgments and creates review records',async()=>{
  const rejected=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,quantity:1}]});
  expect(rejected.status).toBe(400);
  const created=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,manufacturer_unknown:true,model_unknown:true,quantity:2}]});
  expect(created.status).toBe(201);
  const details=await call('/equipment/batches/'+created.body.batch_id);
  expect((details.body.lines as {units:unknown[]}[])[0].units).toHaveLength(2);
  expect(db.sqlite.prepare("SELECT count(*) AS n FROM warehouse_review_items WHERE issue_code IN ('MISSING_MANUFACTURER','MISSING_MODEL')").get()).toEqual({n:4});
 });
 it('filters outstanding, partial and closed batches using unit status',async()=>{
  const created=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer,po_number:'000123'},lines:[line()]});
  const batchId=created.body.batch_id as string;
  expect((await call('/equipment/batches')).body.items).toEqual(expect.arrayContaining([expect.objectContaining({entry_batch_id:batchId})]));
  expect((await call('/equipment/batches?q=ABC&filter=all')).body.items).toEqual(expect.arrayContaining([expect.objectContaining({entry_batch_id:batchId})]));
  const firstId=(created.body.unit_ids as string[])[0];
  expect((await call('/equipment/'+firstId+'/receive','POST',{version:1,confirmed_model:'ABC'})).status).toBe(200);
  expect((await call('/equipment/batches?filter=partial')).body.items).toEqual(expect.arrayContaining([expect.objectContaining({entry_batch_id:batchId})]));
  const before=await call('/equipment/batches/'+batchId);
  expect(before.body.status).toBe('Partially received');
  expect((await call('/equipment/batches/'+batchId+'/cancel','POST',{version:(before.body.batch as {version:number}).version,reason:'Equipment changed'})).status).toBe(200);
  expect((await call('/equipment/batches')).body.items).not.toEqual(expect.arrayContaining([expect.objectContaining({entry_batch_id:batchId})]));
  expect((await call('/equipment/batches?filter=closed')).body.items).toEqual(expect.arrayContaining([expect.objectContaining({entry_batch_id:batchId})]));
 });
 it('preserves original equipment IDs during idempotent quantity increases and audited reductions',async()=>{
  const created=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[line()]});
  const batchId=created.body.batch_id as string,original=created.body.unit_ids as string[];
  const before=await call('/equipment/batches/'+batchId);
  const entry_line_id=(before.body.lines as {entry_line_id:string}[])[0].entry_line_id;
  const edit={version:1,header:{po_number:'000888'},lines:[{entry_line_id,...line(3)}]};
  const first=await call('/equipment/batches/'+batchId,'PATCH',edit,'edit-existing-42');
  const retry=await call('/equipment/batches/'+batchId,'PATCH',edit,'edit-existing-42');
  expect(first.status).toBe(200);expect(retry.body).toEqual(first.body);
  const latest=await call('/equipment/batches/'+batchId);
  expect(latest.body.total).toBe(3);
  expect((latest.body.units as {equipment_id:string}[]).map(u=>u.equipment_id)).toEqual(expect.arrayContaining(original));
  expect((latest.body.batch as {po_number:string}).po_number).toBe('000888');
  expect((await call('/equipment/batches/'+batchId,'PATCH',edit)).status).toBe(409);
  const reduction={version:2,lines:[{entry_line_id,...line(2)}],cancel_unit_ids:[original[0]],reason:'Supplier unavailable'};
  expect((await call('/equipment/batches/'+batchId,'PATCH',reduction)).status).toBe(200);
  expect(db.sqlite.prepare('SELECT cancel_reason FROM equipment WHERE equipment_id=?').get(original[0])).toEqual({cancel_reason:'Supplier unavailable'});
  expect(db.sqlite.prepare('SELECT ordered_qty FROM equipment_batch_lines WHERE entry_line_id=?').get(entry_line_id)).toEqual({ordered_qty:3});
 });
 it('allows any orderer, not a receiver-only employee, to cancel a different employee order',async()=>{
  const created=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[line()]});
  const id=(created.body.unit_ids as string[])[0];
  const orderer:Me={email:'orderer@example.com',name:'Orderer',role:'viewer'};
  const receiver:Me={email:'receiver@example.com',name:'Receiver',role:'viewer'};
  for(const employee of [orderer,receiver])db.sqlite.prepare('INSERT INTO staff_accounts(email,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(employee.email,employee.name,'2026-11-04','2026-11-04');
  db.sqlite.prepare('INSERT INTO staff_permissions(email,permission,granted_by_email,granted_at) VALUES(?,?,?,?)').run(orderer.email,'order_equipment',admin.email,'2026-11-04');
  db.sqlite.prepare('INSERT INTO staff_permissions(email,permission,granted_by_email,granted_at) VALUES(?,?,?,?)').run(receiver.email,'receive_edit_equipment',admin.email,'2026-11-04');
  expect((await call('/equipment/'+id+'/cancel','POST',{version:1},undefined,orderer)).status).toBe(400);
  expect((await call('/equipment/'+id+'/cancel','POST',{version:1,reason:'Ordered by mistake'},undefined,receiver)).status).toBe(403);
  expect((await call('/equipment/'+id+'/cancel','POST',{version:1,reason:'Ordered by mistake'},undefined,orderer)).status).toBe(200);
  expect(db.sqlite.prepare('SELECT status,cancel_reason FROM equipment WHERE equipment_id=?').get(id)).toEqual({status:'cancelled',cancel_reason:'Ordered by mistake'});
  expect((await call('/equipment/'+id+'/receive','POST',{version:2})).status).toBe(409);
  expect((await call('/equipment/labels/prepare','POST',{equipment_ids:[id],skip_first_positions:0})).status).toBe(409);
 });
});


describe('order correction regression cases',()=>{
 const orderLine=(model:string,quantity=2)=>({equipment_type_id:furnace,manufacturer:'Carrier',model,quantity});
 it('allows editing another active line when a historical line is fully cancelled',async()=>{
  const created=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer,notes:'Initial notes'},
   lines:[orderLine('FURNACE'),orderLine('CONDENSER',3)]});
  expect(created.status).toBe(201);
  const batchId=created.body.batch_id as string;
  const before=await call('/equipment/batches/'+batchId);
  const originalLines=before.body.lines as {entry_line_id:string,units:{equipment_id:string}[]}[];
  const cancelledIds=originalLines[0].units.map(u=>u.equipment_id);
  const cancelled=await call('/equipment/batches/'+batchId+'/cancel','POST',{
   version:1,reason:'Equipment changed',unit_ids:cancelledIds
  });
  expect(cancelled.status).toBe(200);
  const change=await call('/equipment/batches/'+batchId,'PATCH',{
   version:2,header:{notes:'Revised notes',po_number:'000017'},
   lines:[
    {entry_line_id:originalLines[0].entry_line_id,...orderLine('FURNACE',0)},
    {entry_line_id:originalLines[1].entry_line_id,...orderLine('CONDENSER',3)}
   ]
  });
  expect(change.status).toBe(200);
  const after=await call('/equipment/batches/'+batchId);
  expect((after.body.batch as {notes:string,po_number:string}).notes).toBe('Revised notes');
  expect((after.body.batch as {po_number:string}).po_number).toBe('000017');
  expect((after.body.lines as {active:number}[])[0].active).toBe(0);
  expect(db.sqlite.prepare("SELECT count(*) AS n FROM equipment WHERE entry_line_id=? AND status='cancelled'").get(originalLines[0].entry_line_id)).toEqual({n:2});
  expect((after.body.units as unknown[]).length).toBe(5);
 });
 it('closes only missing-information reviews for cancelled units and preserves their history',async()=>{
  const created=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},
   lines:[{equipment_type_id:furnace,manufacturer_unknown:true,model_unknown:true,quantity:2}]});
  expect(created.status).toBe(201);
  const [firstId,secondId]=created.body.unit_ids as string[];
  const addReview=await call('/equipment/'+firstId+'/receive','POST',{version:1,confirmed_model:'M'});
  expect(addReview.status).toBe(200);
  const cancel=await call('/equipment/'+secondId+'/cancel','POST',{version:1,reason:'Supplier unavailable'});
  expect(cancel.status).toBe(200);
  const rows=db.sqlite.prepare("SELECT entity_id,issue_code,state FROM warehouse_review_items WHERE issue_code IN ('MISSING_MANUFACTURER','MISSING_MODEL') ORDER BY entity_id,issue_code").all() as {entity_id:string,issue_code:string,state:string}[];
  expect(rows.filter(x=>x.entity_id===secondId).every(x=>x.state==='resolved')).toBe(true);
  expect(rows.filter(x=>x.entity_id===firstId).every(x=>x.state==='open')).toBe(true);
  expect(rows).toHaveLength(4);
 });
 it('preserves received units while editing a different line and rejects unauthorized header changes',async()=>{
  const created=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[orderLine('A'),orderLine('B')]});
  const batchId=created.body.batch_id as string;
  const before=await call('/equipment/batches/'+batchId);
  const groups=before.body.lines as {entry_line_id:string,units:{equipment_id:string}[]}[];
  const receivedId=groups[0].units[0].equipment_id;
  expect((await call('/equipment/'+receivedId+'/receive','POST',{version:1,confirmed_model:'A'})).status).toBe(200);
  const other:Me={email:'orderer2@example.com',name:'Order employee',role:'viewer'};
  db.sqlite.prepare('INSERT INTO staff_accounts(email,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(other.email,other.name,'2026-11-04','2026-11-04');
  db.sqlite.prepare('INSERT INTO staff_permissions(email,permission,granted_by_email,granted_at) VALUES(?,?,?,?)').run(other.email,'order_equipment',admin.email,'2026-11-04');
  const editLines=[{entry_line_id:groups[1].entry_line_id,...orderLine('B',3)}];
  const denied=await call('/equipment/batches/'+batchId,'PATCH',{version:1,header:{po_number:'00333'},lines:editLines},undefined,other);
  expect(denied.status).toBe(403);
  const allowed=await call('/equipment/batches/'+batchId,'PATCH',{version:1,lines:editLines},undefined,other);
  expect(allowed.status).toBe(200);
  expect(db.sqlite.prepare('SELECT status,received_at FROM equipment WHERE equipment_id=?').get(receivedId)).toEqual(expect.objectContaining({status:'received',received_at:expect.any(String)}));
 });
});
