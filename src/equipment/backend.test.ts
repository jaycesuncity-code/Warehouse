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
  const payload={header:{customer_id:stockCustomer,po_number:'123'},lines:[{equipment_type_id:furnace,model:'M',quantity:2}]};
  const a=await call('/equipment/orders','POST',payload,'same-key-123');
  const b=await call('/equipment/orders','POST',payload,'same-key-123');
  expect(a.status).toBe(201);expect(b.status).toBe(201);
  expect(a.body.unit_ids).toEqual(b.body.unit_ids);
  expect(db.sqlite.prepare('SELECT count(*) AS n FROM equipment').get()).toEqual({n:2});
 });
 it('blocks view-only order and receiving mutations',async()=>{
  const res=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,quantity:1}]},undefined,viewer);
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
  const res=await call('/equipment/orders','POST',{header:{customer_id:stockCustomer},lines:[{equipment_type_id:furnace,quantity:9}]});
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
});
