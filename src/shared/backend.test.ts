import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { load, persist, type D1, type Stmt } from '../../functions/lib/database';
import { Tx } from './mock/tx';
import { registerParts } from './mock/endpoints/parts';
import { createZone } from './mock/endpoints/building';
import { createShelf } from './mock/endpoints/shelves';
import { createSlot } from './mock/endpoints/slots';
import { moveLocation, patchLocation } from './mock/endpoints/locations';
import { adjustStock } from './mock/endpoints/stock';
import { undoEvent } from './mock/endpoints/events';
import type { Handler } from './mock/types';
import { onRequest } from '../../functions/api/[[path]]';
class Statement implements Stmt {
 args:unknown[]=[];
 constructor(readonly db:DatabaseSync,readonly sql:string){}
 bind(...args:unknown[]){this.args=args;return this;}
 async all<T>(){return {results:this.db.prepare(this.sql).all(...this.args as (string|number|null)[]) as T[]};}
 async first<T>(){return (await this.all<T>()).results[0]??null;}
}
class LocalDB implements D1 {
 sqlite=new DatabaseSync(':memory:');
 constructor(){this.sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['0001_parts_catalog.sql','0002_warehouse.sql'])this.sqlite.exec(readFileSync(new URL(`../../migrations/${file}`,import.meta.url),'utf8'));}
 prepare(sql:string){return new Statement(this.sqlite,sql);}
 async batch<T>(stmts:Stmt[]){this.sqlite.exec('BEGIN');try{const results=[];for(const stmt of stmts)results.push(await stmt.all<T>());this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
}
const me={email:'tester@example.com',name:'Tester',role:'admin' as const};
let db:LocalDB;
beforeEach(()=>{db=new LocalDB();});
async function call(handler:Handler,body:unknown={},params:Record<string,string>={}){
 const before=await load(db);const tx=new Tx(before,me);
 const reply=handler({method:'POST',body,params,query:new URLSearchParams(),ctx:me,role:me.role,state:tx.state,tx});
 await persist(db,before,tx.state);return reply.body as Record<string,unknown>;
}
describe('relational persistence',()=>{
 it('registers once, survives reload, and never creates stock',async()=>{
  const body={rows:[{part_code:'001-A',part_name:'Tee'}]};
  await call(registerParts,body);await call(registerParts,body);
  const state=await load(db);expect(state.parts).toHaveLength(1);expect(state.parts[0].part_id).toMatch(/^prt-[2-9a-hj-km-np-z]{8}$/);expect(state.stock).toHaveLength(0);expect(state.events).toHaveLength(1);
 });
 it('rolls back every row when a concurrent revision wins',async()=>{
  const old=await load(db);const tx=new Tx(old,me);
  registerParts({method:'POST',body:{rows:[{part_code:'stale',part_name:'Stale'}]},params:{},query:new URLSearchParams(),ctx:me,role:me.role,state:tx.state,tx});
  await call(registerParts,{rows:[{part_code:'winner',part_name:'Winner'}]});
  await expect(persist(db,old,tx.state)).rejects.toThrow();
  expect((await load(db)).parts.map(p=>p.part_code)).toEqual(['winner']);
 });
 it('persists building, stock, par, undo and redo with actor attribution',async()=>{
  await call(createZone,{name:'Warehouse',room_no:'126',polygon_in:[[0,0],[200,0],[200,200],[0,200]],open_edges:[],wall_height_in:192,notes:'Unverified'});
  let state=await load(db);
  await call(createShelf,{name:'A1',zone_id:state.zones[0].zone_id,kind:'shelving',x_in:0,y_in:0,rotation_deg:0,width_in:96,depth_in:24,height_in:72,cols:4,rows:[{row_index:0,row_label:'G',elevation_in:4,clear_height_in:60}]});
  state=await load(db);
  await call(createSlot,{shelf_id:state.shelves[0].shelf_id,row_index:0,col_start:1,width_span:1,height_span:1});
  await call(registerParts,{rows:[{part_code:'A',part_name:'Tee'}]});state=await load(db);
  const part_id=state.parts[0].part_id,slot_id=state.slots[0].slot_id;
  await call(moveLocation,{part_id,slot_id,to_slot_id:slot_id,mode:'add'});
  await call(adjustStock,{part_id,slot_id,delta:8,reason:'Received'});
  state=await load(db);await call(patchLocation,{part_id,slot_id,par_qty:12,version:state.stock[0].version});
  const beforeUndo=await load(db);const ev=beforeUndo.events.at(-1)!;
  const undo=await call(undoEvent,{}, {event_id:ev.event_id});
  expect((await load(db)).stock[0]).toMatchObject({par_qty:0,on_hand_qty:8});
  await call(undoEvent,{}, {event_id:String(undo.event_id)});
  state=await load(db);expect(state.stock[0]).toMatchObject({par_qty:12,on_hand_qty:8});expect(state.events.every(e=>e.by===me.email)).toBe(true);
  await expect(call(patchLocation,{part_id,slot_id,par_qty:99,version:1})).rejects.toThrow();
  expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 });
 it('fails closed without Access configuration or token',async()=>{
  expect((await onRequest({request:new Request('https://app/api/parts'),env:{'warehouse-db':db}})).status).toBe(503);
  expect((await onRequest({request:new Request('https://app/api/parts'),env:{'warehouse-db':db,CF_ACCESS_TEAM_DOMAIN:'suncitylc.cloudflareaccess.com',CF_ACCESS_AUD:'test'}})).status).toBe(401);
 });
});
