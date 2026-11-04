import type { D1 } from './database';
import type { Me } from '../../src/shared/contract';
import { mintId } from '../../src/shared/mock/mint';

type Row = Record<string, unknown>;
type Statement = ReturnType<D1['prepare']>;
type Save = (statements: Statement[], result: unknown, status?: number) => Promise<Response>;
type Context = {db:D1; me:Me; rights:string[]; path:string; method:string; url:URL; body:Row; save:Save};
const text = (value:unknown, max=250) => typeof value==='string'?value.trim().slice(0,max):'';
const norm = (value:unknown) => text(value).replace(/\s+/g,' ').toUpperCase();
const validInt = (value:unknown) => typeof value==='number'&&Number.isInteger(value)?value:-1;
const asRow = (value:unknown):Row => value && typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const stmt = (db:D1,query:string,...args:unknown[]) => db.prepare(query).bind(...args);
const rows = async(db:D1,query:string,...args:unknown[]):Promise<Row[]> => (await stmt(db,query,...args).all<Row>()).results;
const first = async(db:D1,query:string,...args:unknown[]) => stmt(db,query,...args).first<Row>();
const ok = (data:unknown) => Response.json(data,{headers:{'Cache-Control':'no-store'}});
const error = (code:number,message:string,kind='validation') => Response.json({error:kind,message},{status:code,headers:{'Cache-Control':'no-store'}});
const mint = (prefix:'evt'|'rev'|'eqp'|'ebl') => mintId(prefix,()=>false);
const allowed = (me:Me,rights:string[],permission:string) => me.role==='admin'||rights.includes(permission);
const timestamp = () => new Date().toISOString();
const statuses = (records:Row[]) => ({
 total:records.length,
 remaining:records.filter(u=>u.status==='ordered').length,
 received:records.filter(u=>u.received_at!=null).length,
 cancelled:records.filter(u=>u.status==='cancelled').length,
 active:records.filter(u=>u.status!=='cancelled').length
});
export function orderStatus(record:{remaining:number;received:number;cancelled:number;total:number}):string {
 if(record.remaining>0)return record.received>0?'Partially received':'Outstanding';
 if(record.received>0)return record.cancelled>0?'Closed (received + cancelled)':'Fully received';
 return record.cancelled>0?'Fully cancelled':'Closed';
}
function audit(db:D1,actor:Me,action:string,entity:string,entityId:string,before:unknown,after:unknown):Statement {
 return stmt(db,'INSERT INTO events(event_id,at,by,action,entity,entity_id,before,after,reason,undone_by) VALUES(?,?,?,?,?,?,?,?,?,NULL)',
  mint('evt'),timestamp(),actor.email,action,entity,entityId,JSON.stringify(before),JSON.stringify(after),null);
}
function review(db:D1,actor:Me,unitId:string,issue:string):Statement {
 return stmt(db,"INSERT OR IGNORE INTO warehouse_review_items(review_id,entity_type,entity_id,issue_code,severity,dedupe_key,detail_json,state,created_at,created_by) VALUES(?,?,?,?,?,?,?,'open',?,?)",
  mint('rev'),'equipment',unitId,issue,'warning',issue,JSON.stringify({source:'equipment_order'}),timestamp(),actor.email);
}
function clearReview(db:D1,actor:Me,unitId:string,issue:string):Statement {
 return stmt(db,"UPDATE warehouse_review_items SET state='resolved',resolved_at=?,resolved_by=?,version=version+1 WHERE entity_type='equipment' AND entity_id=? AND issue_code=? AND state='open'",
  timestamp(),actor.email,unitId,issue);
}
function clearMissingReviews(db:D1,actor:Me,ids:string[]):Statement {
 return stmt(db,"UPDATE warehouse_review_items SET state='resolved',resolved_at=?,resolved_by=?,version=version+1 WHERE entity_type='equipment' AND issue_code IN ('MISSING_MANUFACTURER','MISSING_MODEL') AND state='open' AND entity_id IN (SELECT value FROM json_each(?))",timestamp(),actor.email,JSON.stringify(ids));
}
const reasons=new Set(['Customer cancelled','Ordered by mistake','Supplier unavailable','Equipment changed','Duplicate order']);
function cancellationReason(body:Row):string {
 const value=text(body.reason,500);
 if(reasons.has(value))return value;
 if(value==='Other'&&text(body.explanation,500))return 'Other: '+text(body.explanation,500);
 return '';
}
function updateStatement(db:D1,table:string,fields:Row,idField:string,id:string,version:number):Statement {
 const columns=Object.keys(fields);
 return stmt(db,'UPDATE '+table+' SET '+(columns.length?columns.map(k=>k+'=?').join(',')+',':'')+'version=version+1 WHERE '+idField+'=? AND version=?',
  ...columns.map(k=>fields[k]),id,version);
}
function insertStatement(db:D1,table:string,fields:Row):Statement {
 const columns=Object.keys(fields);
 return stmt(db,'INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(() => '?').join(',')+')',...columns.map(k=>fields[k]));
}
function lineInput(item:Row,prior?:Row) {
 const equipment_type_id=text(item.equipment_type_id??prior?.equipment_type_id,40);
 const manufacturer=text(item.manufacturer??prior?.manufacturer,150);
 const model=text(item.model??prior?.model,200);
 const manufacturer_unknown=item.manufacturer_unknown===undefined?Boolean(prior?.manufacturer_unknown):item.manufacturer_unknown===true;
 const model_unknown=item.model_unknown===undefined?Boolean(prior?.model_unknown):item.model_unknown===true;
 return {equipment_type_id,manufacturer,model,manufacturer_unknown:!manufacturer&&manufacturer_unknown?1:0,
  model_unknown:!model&&model_unknown?1:0};
}
const validLine = (line:ReturnType<typeof lineInput>) =>
 Boolean(line.equipment_type_id&&(line.manufacturer||line.manufacturer_unknown)&&(line.model||line.model_unknown));

/** Scoped order management. Null lets the established equipment API handle unrelated routes. */
export async function equipmentOrdersRoute(ctx:Context):Promise<Response|null> {
 const {db,me,rights,path,method,url,body,save}=ctx;
 if(path==='/api/equipment/batches'&&method==='GET') {
  const q=norm(url.searchParams.get('q')).slice(0,120);
  const match='%'+q+'%';
  const filter=text(url.searchParams.get('filter')||'outstanding',30);
  if(!['outstanding','partial','closed','all'].includes(filter))return error(400,'Invalid order filter.');
  const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||25)||25,1),100);
  const offset=Math.min(Math.max(Number(url.searchParams.get('offset')||0)||0,0),100000);
  const customerId=text(url.searchParams.get('customer_id'),40);
  const query=[
   "SELECT b.*,c.display_name AS customer_name,c.is_stock,",
   "COUNT(e.equipment_id) AS total,",
   "SUM(CASE WHEN e.status='ordered' THEN 1 ELSE 0 END) AS remaining,",
   "SUM(CASE WHEN e.received_at IS NOT NULL THEN 1 ELSE 0 END) AS received,",
   "SUM(CASE WHEN e.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,",
   "GROUP_CONCAT(DISTINCT t.name) AS equipment_summary",
   "FROM equipment_entry_batches b JOIN customers c ON c.customer_id=b.customer_id",
   "LEFT JOIN equipment e ON e.entry_batch_id=b.entry_batch_id",
   "LEFT JOIN equipment_types t ON t.equipment_type_id=e.equipment_type_id",
   "WHERE (?='' OR b.customer_id=?)",
   "AND (?='' OR UPPER(b.entry_batch_id) LIKE ? OR UPPER(b.po_number) LIKE ? OR UPPER(c.display_name) LIKE ?",
   "OR UPPER(b.requested_by_name) LIKE ? OR UPPER(b.vendor) LIKE ?",
   "OR EXISTS (SELECT 1 FROM equipment eq WHERE eq.entry_batch_id=b.entry_batch_id",
   "AND (UPPER(eq.ordered_model) LIKE ? OR UPPER(eq.manufacturer) LIKE ?)))",
   "GROUP BY b.entry_batch_id",
   "HAVING (?='all' OR (?='outstanding' AND remaining>0)",
   "OR (?='partial' AND remaining>0 AND received>0) OR (?='closed' AND remaining=0))",
   "ORDER BY b.created_at DESC,b.entry_batch_id DESC LIMIT ? OFFSET ?"
  ].join(' ');
  const values=[customerId,customerId,q,match,match,match,match,match,match,match,
   filter,filter,filter,filter,limit+1,offset];
  const results=await rows(db,query,...values);
  const items=results.slice(0,limit).map(r=>({...r,status:orderStatus({
   total:Number(r.total||0),remaining:Number(r.remaining||0),received:Number(r.received||0),cancelled:Number(r.cancelled||0)
  })}));
  return ok({items,limit,offset,next_offset:results.length>limit?offset+limit:null});
 }
 const batchMatch=path.match(/^\/api\/equipment\/batches\/(ebt-[a-z0-9]{8})$/);
 if(batchMatch&&method==='GET') {
  const batch=await first(db,'SELECT b.*,c.display_name AS customer_name FROM equipment_entry_batches b JOIN customers c ON c.customer_id=b.customer_id WHERE b.entry_batch_id=?',batchMatch[1]);
  if(!batch)return error(404,'Order not found.','not_found');
  const lines=await rows(db,'SELECT l.*,t.name AS type_name FROM equipment_batch_lines l JOIN equipment_types t ON t.equipment_type_id=l.equipment_type_id WHERE l.entry_batch_id=? ORDER BY l.line_no',batchMatch[1]);
  const units=await rows(db,[
   "SELECT e.*,t.name AS type_name,c.display_name AS customer_name,",
   "(SELECT count(*) FROM equipment_label_prints p WHERE p.equipment_id=e.equipment_id AND p.confirmed_printed_at IS NOT NULL) AS printed_count",
   "FROM equipment e JOIN equipment_types t ON t.equipment_type_id=e.equipment_type_id",
   "JOIN customers c ON c.customer_id=e.customer_id WHERE e.entry_batch_id=? ORDER BY e.entry_line_id,e.unit_index"
  ].join(' '),batchMatch[1]);
  const grouped=lines.map(line=>{
   const members=units.filter(u=>u.entry_line_id===line.entry_line_id);
   return {...line,units:members,...statuses(members)};
  });
  const history=await rows(db,[
   "SELECT event_id,at,by,action,entity,entity_id,before,after FROM events",
   "WHERE (entity='equipment_batch' AND entity_id=?)",
   "OR (entity='equipment' AND entity_id IN (SELECT equipment_id FROM equipment WHERE entry_batch_id=?))",
   "ORDER BY at DESC,event_id DESC LIMIT 120"
  ].join(' '),batchMatch[1],batchMatch[1]);
  const missing=await rows(db,[
   "SELECT review_id,entity_id,issue_code,state FROM warehouse_review_items",
   "WHERE entity_type='equipment' AND state='open' AND issue_code IN ('MISSING_MANUFACTURER','MISSING_MODEL')",
   "AND entity_id IN (SELECT equipment_id FROM equipment WHERE entry_batch_id=?)"
  ].join(' '),batchMatch[1]);
  const counts=statuses(units);
  return ok({batch,lines:grouped,units,...counts,status:orderStatus(counts),history,missing});
 }
 const cancelBatch=path.match(/^\/api\/equipment\/batches\/(ebt-[a-z0-9]{8})\/cancel$/);
 const cancelUnit=path.match(/^\/api\/equipment\/(eqp-[a-z0-9]{8})\/cancel$/);
 if(method==='POST'&&(cancelBatch||cancelUnit)) {
  if(!allowed(me,rights,'order_equipment'))return error(403,'Ordering permission is required to cancel outstanding equipment.','forbidden');
  const reason=cancellationReason(body);
  if(!reason)return error(400,'Choose a cancellation reason. Other requires an explanation.');
  const batchId=cancelBatch?cancelBatch[1]:text((await first(db,'SELECT entry_batch_id FROM equipment WHERE equipment_id=?',cancelUnit![1]))?.entry_batch_id);
  if(!batchId)return error(404,'Order not found.','not_found');
  const batch=await first(db,'SELECT * FROM equipment_entry_batches WHERE entry_batch_id=?',batchId);
  if(!batch)return error(404,'Order not found.','not_found');
  const existing=await rows(db,'SELECT * FROM equipment WHERE entry_batch_id=? ORDER BY equipment_id',batchId);
  let ids=cancelUnit?[cancelUnit[1]]:Array.isArray(body.unit_ids)?body.unit_ids.map(x=>text(x)):[];
  if(!ids.length&&cancelBatch)ids=existing.filter(u=>u.status==='ordered').map(u=>String(u.equipment_id));
  if(!ids.length||new Set(ids).size!==ids.length||ids.length>25)return error(400,'Choose 1 to 25 distinct outstanding equipment units.');
  const picked=existing.filter(u=>ids.includes(String(u.equipment_id)));
  if(picked.length!==ids.length||picked.some(u=>u.status!=='ordered'))return error(409,'Only outstanding units in this order may be cancelled.','status_conflict');
  if(cancelUnit&&body.version!==picked[0].version)return error(409,'Equipment changed; reload before cancelling.','version_conflict');
  if(cancelBatch&&body.version!==undefined&&body.version!==batch.version)return error(409,'Order changed; reload before cancelling.','version_conflict');
  const at=timestamp(),statements:Statement[]=[];
  for(const unit of picked){
   const after={...unit,status:'cancelled',cancel_reason:reason,cancelled_at:at,cancelled_by_email:me.email,updated_at:at,updated_by_email:me.email,version:Number(unit.version)+1};
   statements.push(updateStatement(db,'equipment',{
    status:'cancelled',cancel_reason:reason,cancelled_at:at,cancelled_by_email:me.email,updated_at:at,updated_by_email:me.email
   },'equipment_id',String(unit.equipment_id),Number(unit.version)));
   statements.push(audit(db,me,'cancel','equipment',String(unit.equipment_id),unit,after));

  }
  statements.push(clearMissingReviews(db,me,ids));
  const remaining=existing.filter(u=>u.status==='ordered'&&!ids.includes(String(u.equipment_id))).length;
  statements.push(updateStatement(db,'equipment_entry_batches',{
   cancelled_at:remaining===0?at:batch.cancelled_at,cancelled_by:remaining===0?me.email:batch.cancelled_by
  },'entry_batch_id',batchId,Number(batch.version)));
  statements.push(audit(db,me,'cancel_batch','equipment_batch',batchId,{outstanding:existing.filter(u=>u.status==='ordered').length},
   {unit_ids:ids,reason,remaining}));
  return save(statements,{unit_ids:ids,affected:ids.length,remaining,reason});
 }
 if(batchMatch&&method==='PATCH') {
  if(!allowed(me,rights,'order_equipment'))return error(403,'Order permission required.','forbidden');
  const batch=await first(db,'SELECT * FROM equipment_entry_batches WHERE entry_batch_id=?',batchMatch[1]);
  if(!batch)return error(404,'Order not found.','not_found');
  if(body.version!==batch.version)return error(409,'Order changed. Reload to edit.','version_conflict');
  const existingLines=await rows(db,'SELECT * FROM equipment_batch_lines WHERE entry_batch_id=? ORDER BY line_no',batchMatch[1]);
  const units=await rows(db,'SELECT * FROM equipment WHERE entry_batch_id=? ORDER BY entry_line_id,unit_index',batchMatch[1]);
  const hasReceived=units.some(u=>u.received_at!=null);
  const receiver=allowed(me,rights,'receive_edit_equipment');
  const incomingHeader=asRow(body.header);
  const headerFields=['customer_id','po_number','vendor','requested_by_name','expected_date','notes'];
  if(Object.keys(incomingHeader).some(k=>!headerFields.includes(k)))return error(400,'Unsupported order header field.');
  const header:Row={};
  for(const key of headerFields)if(incomingHeader[key]!==undefined){
   const raw=text(incomingHeader[key],key==='notes'?1000:key==='po_number'?120:150);
   header[key]=key==='expected_date'?raw||null:raw;
  }
  if(header.customer_id!==undefined) {
   if(!await first(db,'SELECT customer_id FROM customers WHERE customer_id=? AND active=1',header.customer_id))
    return error(400,'Choose an active customer.');
  }
  if(header.expected_date&&!/^\d{4}-\d{2}-\d{2}$/.test(String(header.expected_date)))return error(400,'Expected date must be YYYY-MM-DD.');
  if(header.po_number!==undefined)header.po_normalized=norm(header.po_number);
  const headChanges=Object.keys(header).some(key=>String(header[key]??'')!==String(batch[key]??''));
  if(headChanges&&hasReceived&&!receiver)return error(403,'Changes affecting received equipment require receiving/edit permission.','forbidden');
  const edits=body.lines===undefined?[]:Array.isArray(body.lines)?body.lines.map(asRow):null;
  if(edits===null||edits.length>10)return error(400,'Provide at most 10 edited lines.');
  const seen=new Set<string>(),statements:Statement[]=[];
  const at=timestamp(),newIds:string[]=[];
  const knownTypes=new Set((await rows(db,'SELECT equipment_type_id FROM equipment_types WHERE active=1')).map(t=>String(t.equipment_type_id)));
  const cancelIds=Array.isArray(body.cancel_unit_ids)?body.cancel_unit_ids.map(x=>text(x)):[];
  if(new Set(cancelIds).size!==cancelIds.length)return error(400,'Duplicate cancellation selections.');
  const cancelReason=cancelIds.length?cancellationReason(body):'';
  const patches=new Map<string,Row>();
  const affected=new Map<string,Row>();
  if(cancelIds.length&&!cancelReason)return error(400,'Reducing quantity requires a cancellation reason.');
  const expectedCancel:string[]=[];
  let nextLine=Math.max(0,...existingLines.map(l=>Number(l.line_no)));
  let createdCount=0;
  for(const edit of edits){
   const lineId=text(edit.entry_line_id);
   const original=lineId?existingLines.find(l=>l.entry_line_id===lineId):undefined;
   if(lineId&&!original)return error(400,'Order line does not belong to this order.');
   if(lineId&&seen.has(lineId))return error(400,'Duplicate line edit.');
   if(lineId)seen.add(lineId);
   const info=lineInput(edit,original);
   if(!validLine(info)||!knownTypes.has(info.equipment_type_id))return error(400,'Equipment type, manufacturer, and model are required unless explicitly marked Unknown.');
   const members=original?units.filter(u=>u.entry_line_id===lineId):[];
   const currentActive=members.filter(u=>u.status!=='cancelled').length;
   const quantity=edit.quantity===undefined?currentActive:validInt(edit.quantity);
   if(quantity<0||quantity>25||(!original&&quantity<1)||(original&&currentActive===0&&quantity!==0))
    return error(400,'Historical fully cancelled lines must remain at zero; new lines require at least one active unit.');
   const changeCount=quantity-currentActive;
   const changedMeta=Boolean(original&&(
    info.equipment_type_id!==original.equipment_type_id||info.manufacturer!==original.manufacturer||
    info.model!==original.model||info.manufacturer_unknown!==Number(original.manufacturer_unknown)||
    info.model_unknown!==Number(original.model_unknown)
   ));
   if(changedMeta&&currentActive===0)return error(400,'Fully cancelled lines are historical and cannot be changed.');
   if(changedMeta&&members.some(u=>u.received_at!=null)&&!receiver)
    return error(403,'Changing a partially received line requires receiving/edit permission.','forbidden');
   if(changeCount<0){
    const selected=members.filter(u=>cancelIds.includes(String(u.equipment_id)));
    if(selected.length!==-changeCount||selected.some(u=>u.status!=='ordered'))
     return error(400,'Select exactly the outstanding Equipment IDs being removed from this line.');
    expectedCancel.push(...selected.map(u=>String(u.equipment_id)));
   }
   if(original&&Number(original.ordered_qty)+Math.max(0,changeCount)>25)
    return error(400,'Line historical quantity would exceed 25; create a separate order.');
   let newLineId=lineId;
   if(original){
    if(changedMeta||changeCount>0) {
     statements.push(stmt(db,
      'UPDATE equipment_batch_lines SET equipment_type_id=?,manufacturer=?,model=?,manufacturer_unknown=?,model_unknown=?,ordered_qty=ordered_qty+? WHERE entry_line_id=?',
      info.equipment_type_id,info.manufacturer,info.model,info.manufacturer_unknown,info.model_unknown,Math.max(0,changeCount),lineId));
    }
    if(changedMeta){
     for(const unit of members.filter(u=>u.status!=='cancelled'&&!cancelIds.includes(String(u.equipment_id)))){
      patches.set(String(unit.equipment_id),{
       ...patches.get(String(unit.equipment_id)),equipment_type_id:info.equipment_type_id,
       manufacturer:info.manufacturer,manufacturer_normalized:norm(info.manufacturer),
       ordered_model:info.model,manufacturer_unknown:info.manufacturer_unknown,
       model_unknown:info.model_unknown
      });
      affected.set(String(unit.equipment_id),unit);
      if(info.manufacturer_unknown)statements.push(review(db,me,String(unit.equipment_id),'MISSING_MANUFACTURER'));
      else statements.push(clearReview(db,me,String(unit.equipment_id),'MISSING_MANUFACTURER'));
      if(info.model_unknown)statements.push(review(db,me,String(unit.equipment_id),'MISSING_MODEL'));
      else statements.push(clearReview(db,me,String(unit.equipment_id),'MISSING_MODEL'));
     }
    }
   } else {
    if(existingLines.length+edits.filter(x=>!x.entry_line_id).length>10)return error(400,'An order supports at most 10 saved lines.');
    nextLine++;
    newLineId=mint('ebl');
    statements.push(insertStatement(db,'equipment_batch_lines',{
     entry_line_id:newLineId,entry_batch_id:batchMatch[1],line_no:nextLine,equipment_type_id:info.equipment_type_id,
     manufacturer:info.manufacturer,model:info.model,manufacturer_unknown:info.manufacturer_unknown,model_unknown:info.model_unknown,
     vendor:header.vendor??batch.vendor,ordered_qty:quantity
    }));
   }
   if(changeCount>0||!original) {
    const additional=original?changeCount:quantity;
    const actualLineId=newLineId;
    for(let n=0;n<additional;n++){
     const equipmentId=mint('eqp');
     const index=Math.max(0,...members.map(u=>Number(u.unit_index)))+n+1;
     const unit:Row={equipment_id:equipmentId,entry_batch_id:batchMatch[1],entry_line_id:actualLineId,unit_index:index,
      source:'ordered',equipment_type_id:info.equipment_type_id,customer_id:header.customer_id??batch.customer_id,
      po_number:header.po_number??batch.po_number,po_normalized:header.po_normalized??batch.po_normalized,
      requested_by_name:header.requested_by_name??batch.requested_by_name,requested_by_email:batch.requested_by_email,
      expected_date:header.expected_date??batch.expected_date,vendor:header.vendor??original?.vendor??batch.vendor,notes:header.notes??batch.notes,
      manufacturer:info.manufacturer,manufacturer_normalized:norm(info.manufacturer),ordered_model:info.model,
      manufacturer_unknown:info.manufacturer_unknown,model_unknown:info.model_unknown,status:'ordered',
      entered_by_email:me.email,created_at:at,updated_at:at,updated_by_email:me.email};
     statements.push(insertStatement(db,'equipment',unit));
     if(info.manufacturer_unknown)statements.push(review(db,me,equipmentId,'MISSING_MANUFACTURER'));
     if(info.model_unknown)statements.push(review(db,me,equipmentId,'MISSING_MODEL'));
     newIds.push(equipmentId);createdCount++;
    }
   }
  }
  if(createdCount>25||units.length+createdCount>25)return error(400,'A batch supports at most 25 historical Equipment IDs.');
  if(cancelIds.length!==expectedCancel.length||cancelIds.some(x=>!expectedCancel.includes(x)))
   return error(400,'Cancellation selections do not match the quantity reductions.');
  for(const equipmentId of cancelIds) {
   const unit=units.find(u=>u.equipment_id===equipmentId)!;
   statements.push(updateStatement(db,'equipment',{
    status:'cancelled',cancel_reason:cancelReason,cancelled_at:at,cancelled_by_email:me.email,updated_at:at,updated_by_email:me.email
   },'equipment_id',equipmentId,Number(unit.version)));
   statements.push(audit(db,me,'cancel','equipment',equipmentId,unit,{...unit,status:'cancelled',cancel_reason:cancelReason}));

  }
  if(cancelIds.length)statements.push(clearMissingReviews(db,me,cancelIds));
  if(header.vendor!==undefined&&header.vendor!==batch.vendor)
   statements.push(stmt(db,'UPDATE equipment_batch_lines SET vendor=? WHERE entry_batch_id=?',header.vendor,batchMatch[1]));
  if(headChanges)for(const unit of units.filter(u=>u.status!=='cancelled'&&!cancelIds.includes(String(u.equipment_id)))) {
   const key=String(unit.equipment_id);
   patches.set(key,{...patches.get(key),...header});
   affected.set(key,unit);
  }
  for(const [key,patch] of patches){
   const unit=affected.get(key)!;
   const values={...patch,updated_at:at,updated_by_email:me.email};
   statements.push(updateStatement(db,'equipment',values,'equipment_id',key,Number(unit.version)));
   statements.push(audit(db,me,'edit_order_unit','equipment',key,unit,{...unit,...values,version:Number(unit.version)+1}));
  }
  const changed=statements.length>0||headChanges;
  if(!changed)return ok({batch_id:batchMatch[1],changed:false,unit_ids:[]});
  statements.unshift(updateStatement(db,'equipment_entry_batches',{...header},'entry_batch_id',batchMatch[1],Number(batch.version)));
  statements.push(audit(db,me,'edit_order','equipment_batch',batchMatch[1],batch,
   {header,updated_lines:edits.length,created_unit_ids:newIds,cancelled_unit_ids:cancelIds,cancellation_reason:cancelReason}));
  return save(statements,{batch_id:batchMatch[1],changed:true,unit_ids:newIds,cancelled_unit_ids:cancelIds,version:Number(batch.version)+1});
 }
 return null;
}
