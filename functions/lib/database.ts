import type { MockState } from '../../src/shared/mock/state';
import type { ApiEvent } from '../../src/shared/contract';
export interface Stmt { bind(...args: unknown[]): Stmt; all<T>(): Promise<{results:T[]}>; first<T>(): Promise<T|null> }
export interface D1 { prepare(query:string):Stmt; batch<T=Record<string,unknown>>(stmts:Stmt[]):Promise<{results:T[]}[]> }
export type Env = {'warehouse-db'?:D1;CF_ACCESS_TEAM_DOMAIN?:string;CF_ACCESS_AUD?:string;WAREHOUSE_EDITORS?:string;WAREHOUSE_ADMINS?:string};
export type Ctx = {request:Request;env:Env};
type RecordRow = Record<string, unknown>;
const tables = ['zones','openings','shelves','slots','parts','stock','events'] as const;
const jsonColumns = new Set(['polygon_in','open_edges','aliases','before','after']);
const boolColumns = new Set(['active','verified']);
function decode(row:RecordRow):RecordRow {
 return Object.fromEntries(Object.entries(row).filter(([k])=>k!=='created_at'&&k!=='updated_at').map(([k,v])=>[k,jsonColumns.has(k)?JSON.parse(String(v)):boolColumns.has(k)?!!v:v]));
}
/** One D1 batch supplies a consistent relational snapshot to the shared domain rules. */
export async function load(db:D1):Promise<MockState> {
 const results = await db.batch([...tables.map(t=>db.prepare(`SELECT * FROM ${t}`)),db.prepare('SELECT * FROM shelf_rows ORDER BY row_index'),db.prepare('SELECT * FROM warehouse_meta WHERE id=1')]);
 const data = Object.fromEntries(tables.map((t,i)=>[t,results[i].results.map(decode)]));
 for(const shelf of data.shelves) shelf.rows=results[7].results.filter(r=>r.shelf_id===shelf.shelf_id).map(({shelf_id:_,...row})=>row);
 const meta=results[8].results[0];
 if(!meta)throw new Error('Missing warehouse migration');
 return {...data,schema:1,seq:Number(meta.revision),updated_at:String(meta.updated_at)} as unknown as MockState;
}
function key(table:string,row:RecordRow):string {return table==='stock'?`${row.part_id}|${row.slot_id}`:String(row[table==='shelves'?'shelf_id':table==='parts'?'part_id':table==='slots'?'slot_id':table==='zones'?'zone_id':table==='openings'?'opening_id':'event_id']);}
function upsert(db:D1,table:string,row:RecordRow):Stmt {
 const cols=Object.keys(row);const vals=cols.map(k=>jsonColumns.has(k)?JSON.stringify(row[k]):boolColumns.has(k)?Number(row[k]):row[k]??null);
 const pk=table==='stock'?['part_id','slot_id']:[cols.find(k=>k.endsWith('_id'))!];
 const changes=cols.filter(k=>!pk.includes(k)&&k!=='created_at').map(k=>`"${k}"=excluded."${k}"`).join(',');
 return db.prepare(`INSERT INTO "${table}" (${cols.map(k=>`"${k}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON CONFLICT(${pk.join(',')}) DO UPDATE SET ${changes}`).bind(...vals);
}
/** Global revision CAS and every changed row/event commit atomically in a D1 batch. */
export async function persist(db:D1,before:MockState,after:MockState):Promise<void> {
 const stmts:Stmt[]=[db.prepare('UPDATE warehouse_meta SET revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END,updated_at=? WHERE id=1').bind(before.seq,new Date().toISOString())];
 for(const table of tables){
  const old=new Map((before[table] as unknown as RecordRow[]).map(r=>[key(table,r),r]));
  for(const raw of after[table] as unknown as RecordRow[]){
   if(JSON.stringify(old.get(key(table,raw)))===JSON.stringify(raw))continue;
   const row={...raw};
   if(table==='shelves')delete row.rows;
   if(table==='parts'){row.created_at=new Date().toISOString();row.updated_at=row.created_at;}
   stmts.push(upsert(db,table,row));
   if(table==='shelves'){
    stmts.push(db.prepare('DELETE FROM shelf_rows WHERE shelf_id=?').bind(row.shelf_id));
    for(const rr of raw.rows as RecordRow[])stmts.push(db.prepare('INSERT INTO shelf_rows(shelf_id,row_index,row_label,elevation_in,clear_height_in) VALUES(?,?,?,?,?)').bind(row.shelf_id,rr.row_index,rr.row_label,rr.elevation_in,rr.clear_height_in));
   }
  }
 }
 if(stmts.length>1)await db.batch(stmts);
}
export function publicEvents(events:ApiEvent[],viewer:boolean):ApiEvent[]{
 return viewer?events.map(e=>({...e,before:{},after:{}})):events;
}
