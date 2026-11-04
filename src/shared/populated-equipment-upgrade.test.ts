import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const sql=(name:string)=>readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8');
const files=['0001_parts_catalog.sql','0002_warehouse.sql','0003_unverified_building.sql','0004_packouts_and_retries.sql','0005_zone_area_kind.sql','0006_equipment_foundation.sql','0007_equipment_map_positions.sql'];

describe('0008 populated equipment upgrade',()=>{
 it('preserves active, received and cancelled unit identities, snapshots, and unrelated warehouse data',()=>{
  const db=new DatabaseSync(':memory:');
  try {
   db.exec('PRAGMA foreign_keys=ON');
   for(const file of files)db.exec(sql(file));
   const time='2026-11-03T09:00:00Z';
   const batch='ebt-22222222',line='ebl-22222222',line2='ebl-22222223';
   db.prepare('INSERT INTO equipment_entry_batches(entry_batch_id,customer_id,requested_by_name,entered_by_email,created_at,po_number,po_normalized) VALUES(?,?,?,?,?,?,?)')
     .run(batch,'cus-stk22222','Manager','manager@example.com',time,'00017','00017');
   for(const [id,lineNo,qty] of [[line,1,3],[line2,2,1]] as const) {
    db.prepare('INSERT INTO equipment_batch_lines(entry_line_id,entry_batch_id,line_no,equipment_type_id,manufacturer,model,ordered_qty) VALUES(?,?,?,?,?,?,?)')
      .run(id,batch,lineNo,'ety-22222222','Carrier','M-100',qty);
   }
   for(const [index,status,received,cancelled] of [[1,'ordered',null,null],[2,'received',time,null],[3,'cancelled',null,time],[4,'received',time,null]] as const) {
    const unit='eqp-2222222'+index;
    db.prepare('INSERT INTO equipment(equipment_id,entry_batch_id,entry_line_id,unit_index,source,equipment_type_id,customer_id,po_number,po_normalized,manufacturer,ordered_model,status,received_at,cancelled_at,entered_by_email,created_at,updated_at,updated_by_email) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(unit,batch,index===4?line2:line,index===4?1:index,'ordered','ety-22222222','cus-stk22222','00017','00017','Carrier','M-100',status,received,cancelled,'manager@example.com',time,time,'manager@example.com');
   }
   db.prepare("INSERT INTO warehouse_review_items(review_id,entity_type,entity_id,issue_code,dedupe_key,created_at,created_by) VALUES('rev-22222222','equipment','eqp-22222221','MODEL_MISMATCH','MODEL_MISMATCH',?,?)").run(time,'manager@example.com');
   db.prepare("INSERT INTO equipment_label_prints(label_print_id,equipment_id,entry_batch_id,sheet_run_id,page_number,sheet_position,printed_snapshot_json,label_fingerprint,prepared_at,prepared_by_email,confirmed_printed_at) VALUES('elp-22222222','eqp-22222221',?,'run-1',1,1,'{}','{}',?,'manager@example.com',?)").run(batch,time,time);
   db.prepare("INSERT INTO events(event_id,at,by,action,entity,entity_id,before,after,reason,undone_by) VALUES('evt-33333333',?,'manager@example.com','receive','equipment','eqp-22222222','{}','{}',NULL,NULL)").run(time);
   const tables=['equipment','equipment_batch_lines','equipment_entry_batches','customers','equipment_types','warehouse_review_items','equipment_label_prints','events','parts','stock','shelves','slots','packouts'];
   const before=new Map(tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
   db.exec(sql('0008_equipment_order_management.sql'));
   for(const table of tables){
    const original=before.get(table)! as Record<string,unknown>[];
    const current=db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all() as Record<string,unknown>[];
    expect(current.length,table).toBe(original.length);
    for(let i=0;i<original.length;i++)for(const [field,value] of Object.entries(original[i]))
     expect(current[i][field],table+' row '+i+' field '+field).toEqual(value);
   }
   expect(db.prepare("SELECT manufacturer_unknown,model_unknown,cancel_reason FROM equipment WHERE equipment_id='eqp-22222223'").get())
    .toEqual({manufacturer_unknown:0,model_unknown:0,cancel_reason:''});
   expect(db.prepare('SELECT manufacturer_unknown,model_unknown FROM equipment_batch_lines WHERE entry_line_id=?').get(line))
    .toEqual({manufacturer_unknown:0,model_unknown:0});
   for(const name of ['equipment_batches_recent','equipment_batches_requested','equipment_batches_vendor'])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name)).toEqual({name});
   expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
   expect(db.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
  } finally {db.close();}
 });
});
