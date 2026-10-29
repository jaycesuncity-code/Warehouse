import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { integratedRenderer } from './renderer';
const source=readFileSync(new URL('../../labels/bin-label-generator.html',import.meta.url),'utf8');
describe('preserved vector label renderer integration',()=>{
 it('fails closed if the source integration anchors change',()=>expect(()=>integratedRenderer('<html></html>')).toThrow());
 it('renders a confirmed snapshot without modifying staged rows and rejects invalid IDs',async()=>{
  const errors:unknown[]=[];
  const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(integratedRenderer(source),{runScripts:'dangerously',url:'https://labels.test',virtualConsole:console,beforeParse(w){
   w.structuredClone=structuredClone;
   w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
   w.HTMLElement.prototype.scrollIntoView=()=>{};
  }});
  type Row={k:number;id:string;idSrc:string;name:string;code:string;qty:string;ex:Record<string,string>;iss:unknown[]};
  const w=dom.window;
  const bridge=(w as unknown as {__BLG:{rows:Row[];S:Record<string,number>;renderConfirmed:(r:Row[])=>Promise<Blob>}}).__BLG;
  expect(bridge,errors.map(String).join('\n')).toBeDefined();
  const row={k:1,id:'prt-abcdefgh',idSrc:'reused',name:'Test Tee',code:'001',qty:'99',ex:{Vendor:'Test'},iss:[]};
  bridge.rows.push({...row,name:'Unselected'});
  await expect(bridge.renderConfirmed([{...row,id:'invented'}])).rejects.toThrow();
  const blob=await bridge.renderConfirmed([row]);
  expect(bridge.rows[0].name).toBe('Unselected');
  expect(bridge.S.labelW).toBe(2.95);expect(bridge.S.labelH).toBe(.84);
  const data=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(blob);});
  expect(new TextDecoder().decode(data).startsWith('%PDF')).toBe(true);
  writeFileSync('/tmp/warehouse-confirmed-label.pdf',Buffer.from(data));
  dom.window.close();
 });
});
