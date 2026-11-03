import { describe, expect, it } from 'vitest';
import { avery5821Pdf, AVERY_5821, type EquipmentLabel } from './pdf';
import { idKind, isEquipmentId } from '../shared/ids';

const label = (i:number): EquipmentLabel => ({
 equipment_id:'eqp-22222222', customer_name:'Smith Residence', is_stock:0,
 po_number:'004471',type_name:'Condenser',ordered_model:'XYZ-123',
 requested_by_name:'Jordan',expected_date:'2026-11-12',unit_index:i+1,
 ordered_qty:10,label_print_id:'elp-22222222',page_number:Math.floor(i/8)+1,sheet_position:i%8+1,
});
describe('equipment ID and Avery 5821 PDF',()=>{
 it('recognizes equipment separately from parts',()=>{
  expect(isEquipmentId('eqp-22222222')).toBe(true);
  expect(idKind('eqp-22222222')).toBe('eqp');
  expect(idKind('prt-22222222')).toBe('prt');
  expect(isEquipmentId('prt-22222222')).toBe(false);
 });
 it('uses 2x4 positions on physical Letter pages',()=>{
  expect(AVERY_5821.pageW).toBe(612);
  expect(AVERY_5821.pageH).toBe(792);
  expect(AVERY_5821.perPage).toBe(8);
  expect(AVERY_5821.labelW).toBe(288);
  expect(AVERY_5821.labelH).toBe(180);
 });
 it('writes an actual two-page PDF with 10 equipment QR payloads',async()=>{
  const labels=Array.from({length:10},(_,i)=>label(i));
  const pdf=avery5821Pdf(labels);
  const source=await pdf.text();
  expect(pdf.type).toBe('application/pdf');
  expect(source).toMatch(/^%PDF-1\.4/);
  expect(source).toContain('/Count 2');
  expect(source.match(/\(eqp-22222222\)/g)?.length).toBe(10);
  expect(source).toContain('(PO: 004471)');
  expect(source).toContain('(Serial: ______________________)');
  expect(source).toContain('(Unit 1 of 10)');
 });
 it('prints calibration sheet with 8 alignment rectangles',async()=>{
  const pdf=avery5821Pdf([],true);
  const source=await pdf.text();
  expect(source).toContain('/Count 1');
  expect(source.match(/\(1 inch\)/g)?.length).toBe(8);
 });
 it('rejects sheet positions outside 1-8',()=>{
  expect(()=>avery5821Pdf([{...label(0),sheet_position:9}])).toThrow('Invalid label position');
 });
});
