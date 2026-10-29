import { beforeEach, describe, expect, it } from 'vitest';
import type { Employee, Packout, Part, Role, Shelf, Slot } from './contract';
import { handleMockRequest } from './mock/router';
import { loadState, resetState, setMockStorage } from './mock/state';

function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, role: Role = 'editor') {
  return handleMockRequest(method, `/api${path}`, { body, role });
}
function success<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): T {
  const r = request(method, path, body);
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return r.body as T;
}
let kit: Packout, employee: Employee, part: Part, source: string, shelf: Shelf;
const current = () => success<{items: Packout[]}>('GET', '/packouts').items.find(row => row.kit_id === kit.kit_id)!;
const currentPart = () => success<Part>('GET', `/parts/${part.part_id}`);
function replenish(qty = 8) {
  const p = currentPart(), k = current();
  return success<{kit: Packout; event_id: string}>('POST', `/packouts/${kit.kit_id}/replenish`, {
    version: k.version, part_id: part.part_id, from_slot_id: source,
    from_version: p.locations.find(row => row.slot_id === source)!.version, qty,
  });
}
function issue() {
  return success<{kit: Packout; event_id: string}>('POST', `/packouts/${kit.kit_id}/issue`, {version: current().version, employee_id: employee.employee_id});
}
function returnKit(remaining: number) {
  return success<{kit: Packout; event_id: string}>('POST', `/packouts/${kit.kit_id}/return`, {version: current().version, counts: [{part_id: part.part_id, remaining_qty: remaining}]});
}
beforeEach(() => {
  setMockStorage(null); resetState();
  shelf = success<{shelf:Shelf}>('POST', '/shelves', {name:'Kit staging',location_type:'packout',zone_id:loadState().zones[0].zone_id,kind:'shelving',x_in:200,y_in:600,rotation_deg:0,width_in:96,depth_in:24,height_in:72,cols:4,rows:[{row_index:0,row_label:'G',elevation_in:4,clear_height_in:60}]}).shelf;
  const slot = success<{slot:Slot}>('POST', '/slots', {shelf_id:shelf.shelf_id,row_index:0,col_start:1,width_span:1,height_span:1}).slot;
  kit = success<{kit:Packout}>('POST','/packouts',{name:'BOX 12',slot_id:slot.slot_id}).kit;
  employee = success<{employee:Employee}>('POST','/employees',{name:'Warehouse employee',email:'demo.manager@suncity.example'}).employee;
  const candidates = success<{items:Part[]}>('GET','/parts?limit=100').items;
  part = candidates.find(p=>p.locations.some(row=>row.on_hand_qty>=20))!;
  source = part.locations.find(row=>row.on_hand_qty>=20)!.slot_id;
});

describe('packout custody and stock accounting', () => {
  it('transfers without creating stock, issues without consuming, and consumes only counted use on return', () => {
    const total = part.on_hand_total;
    replenish();
    expect(currentPart().on_hand_total).toBe(total);
    expect(currentPart().available_total).toBe(total);
    issue();
    expect(currentPart()).toMatchObject({on_hand_total:total,available_total:total-8,issued_total:8});
    expect(current().employee_id).toBe(employee.employee_id);
    returnKit(3);
    expect(currentPart()).toMatchObject({on_hand_total:total-5,available_total:total-5,issued_total:0});
    expect(current()).toMatchObject({status:'available',employee_id:null,issued_contents:[]});
    expect(loadState().events.filter(e=>e.entity_id===kit.kit_id).map(e=>e.action)).toEqual(['create','replenish','issue','return']);
    expect(loadState().stock.find(r=>r.part_id===part.part_id&&r.slot_id===kit.slot_id)?.counted_by).toBe('demo.manager@suncity.example');
  });
  it('requires all counted rows exactly once and rejects gains, fractions, negatives, missing or extra parts atomically', () => {
    replenish(); issue();
    const state = JSON.stringify(loadState());
    const payloads = [[],[{part_id:part.part_id,remaining_qty:9}],[{part_id:part.part_id,remaining_qty:-1}],[{part_id:part.part_id,remaining_qty:2.5}],[{part_id:'prt-22222222',remaining_qty:1}],[{part_id:part.part_id,remaining_qty:1},{part_id:part.part_id,remaining_qty:1}]];
    for (const counts of payloads) {
      expect(request('POST',`/packouts/${kit.kit_id}/return`,{version:current().version,counts}).status).toBe(400);
      expect(JSON.stringify(loadState())).toBe(state);
    }
  });
  it('locks issued quantities across stock adjustments, moves, deletions, and dependent geometry changes', () => {
    replenish(); issue(); const before = JSON.stringify(loadState());
    expect(request('POST','/stock/adjust',{part_id:part.part_id,slot_id:kit.slot_id,delta:-1}).status).toBe(400);
    expect(request('DELETE','/locations',{part_id:part.part_id,slot_id:kit.slot_id}).status).toBe(400);
    expect(request('POST','/locations/move',{part_id:part.part_id,from_slot_id:kit.slot_id,to_slot_id:source,mode:'share'}).status).toBe(400);
    expect(request('DELETE',`/shelves/${shelf.shelf_id}`,{force:true},'admin').status).toBe(400);
    expect(request('PATCH',`/employees/${employee.employee_id}`,{version:employee.version,active:false}).status).toBe(400);
    expect(request('PATCH',`/shelves/${shelf.shelf_id}`,{version:shelf.version,location_type:'primary'}).status).toBe(400);
    expect(JSON.stringify(loadState())).toBe(before);
  });
  it('rejects repeated issue/return/replenishment versions and insufficient source stock', () => {
    const v = current().version; replenish();
    expect(request('POST',`/packouts/${kit.kit_id}/replenish`,{version:v,part_id:part.part_id,from_slot_id:source,from_version:1,qty:8}).status).toBe(409);
    const issued = issue();
    expect(request('POST',`/packouts/${kit.kit_id}/issue`,{version:issued.kit.version,employee_id:employee.employee_id}).status).toBe(400);
    returnKit(0);
    expect(request('POST',`/packouts/${kit.kit_id}/return`,{version:current().version,counts:[{part_id:part.part_id,remaining_qty:0}]}).status).toBe(400);
    const remaining = currentPart().locations.find(row=>row.slot_id===source)!;
    expect(request('POST',`/packouts/${kit.kit_id}/replenish`,{version:current().version,part_id:part.part_id,from_slot_id:source,from_version:remaining.version,qty:remaining.on_hand_qty+1}).status).toBe(400);
  });
  it('supports audited return undo and redo without double counting', () => {
    const total = part.on_hand_total; replenish();issue();const returned = returnKit(2);
    const undone = success<{event_id:string}>('POST',`/events/${returned.event_id}/undo`,{});
    expect(currentPart()).toMatchObject({on_hand_total:total,issued_total:8,available_total:total-8});
    expect(current().status).toBe('issued');
    success('POST',`/events/${undone.event_id}/undo`,{});
    expect(currentPart()).toMatchObject({on_hand_total:total-6,issued_total:0});
    expect(current().status).toBe('available');
    expect(request('POST',`/events/${returned.event_id}/undo`,{}).status).toBe(409);
  });
  it('rejects stale undo once later stock depends on a return', () => {
    replenish();issue();const returned=returnKit(4);replenish(1);
    expect(request('POST',`/events/${returned.event_id}/undo`,{}).status).toBe(409);
    expect(current().contents[0].on_hand_qty).toBe(5);
  });
  it('keeps kits per bin unique and lets viewers see only their issued kits, with no mutations', () => {
    expect(request('POST','/packouts',{name:'Other kit',slot_id:kit.slot_id}).status).toBe(400);
    expect(request('POST','/employees',{name:'Other',email:'DEMO.MANAGER@SUNCITY.EXAMPLE'}).status).toBe(400);
    for(const [path,body] of [['/packouts',{name:'No',slot_id:kit.slot_id}],['/employees',{name:'No',email:'no@example.com'}],[`/packouts/${kit.kit_id}/issue`,{version:1,employee_id:employee.employee_id}]] as const) expect(request('POST',path,body,'viewer').status).toBe(403);
    expect((request('GET','/packouts',undefined,'viewer').body as {items:Packout[]}).items).toHaveLength(0);
    employee=success<{employee:Employee}>('POST','/employees',{name:'Demo viewer',email:'demo.viewer@suncity.example'}).employee;
    replenish();issue();
    expect((request('GET','/packouts',undefined,'viewer').body as {items:Packout[]}).items).toHaveLength(1);
  });
  it('preserves scanner ID rules and distinguishes all three storage types', () => {
    expect(part.part_id).toMatch(/^prt-[2-9a-hj-km-np-z]{8}$/);
    replenish();
    expect(currentPart().locations.find(row=>row.slot_id===kit.slot_id)?.location_type).toBe('packout');
    const sourceShelf=success<Shelf>('GET',`/shelves/${part.locations.find(row=>row.slot_id===source)!.shelf_id}`);
    success('PATCH',`/shelves/${sourceShelf.shelf_id}`,{version:sourceShelf.version,location_type:'overstock'});
    expect(currentPart().locations.find(row=>row.slot_id===source)?.location_type).toBe('overstock');
  });
});
