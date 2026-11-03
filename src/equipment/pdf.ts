import qrcode from 'qrcode-generator';

export interface EquipmentLabel {
  equipment_id: string; customer_name: string; is_stock: number; po_number: string;
  type_name: string; ordered_model: string; requested_by_name: string;
  expected_date: string | null; unit_index: number | null; ordered_qty: number | null;
  label_print_id: string; page_number: number; sheet_position: number;
}
/** US Letter, 2 by 4 Avery 5821. 4 x 2.5 inches per label. Coordinates in PDF points. */
export const AVERY_5821 = { pageW: 612, pageH: 792, labelW: 288, labelH: 180, left: 12.6, right: 311.4, top: 36, rowStep: 180, perPage: 8 } as const;
const clean = (text: unknown, max = 80) => Array.from(String(text ?? '')).map(char => { const n = char.charCodeAt(0); return n < 32 || n > 126 ? ' ' : char; }).join('').slice(0, max);
const pdfText = (v: unknown) => clean(v).replace(/[\\()]/g, s => '\\' + s);
const trim = (v: unknown, len: number) => clean(v).slice(0, len);
/** Approximate Helvetica glyph widths and shrink/ellipsis text before it reaches its allocated band. */
const approximateWidth=(value:string,size:number)=>Array.from(value).reduce((sum,ch)=>{
  const fraction=/[MW@%&]/.test(ch)?0.9:/[ilI.,' ]/.test(ch)?0.29:/[A-Z]/.test(ch)?0.68:0.54;
  return sum+size*fraction;
},0);
export const fittedLabelText=(value:unknown,availableWidth:number,preferredSize:number,minSize=8)=>{
  let label=clean(value,160),size=preferredSize;
  while(size>minSize&&approximateWidth(label,size)>availableWidth)size=Math.max(minSize,size-0.5);
  if(approximateWidth(label,size)>availableWidth){
    while(label.length>0&&approximateWidth(label+'...',size)>availableWidth)label=label.slice(0,-1);
    label+='...';
  }
  return {value:label,size};
};
const encoded = (value: string) => new TextEncoder().encode(value);
/** Self-contained vector-PDF writer; no browser viewer, external asset, or server PDF endpoint required. */
export function avery5821Pdf(labels: EquipmentLabel[], testPage = false): Blob {
  const pages = testPage ? 1 : Math.max(1, ...labels.map(x => x.page_number));
  const objects: string[] = [], push = (v: string) => { objects.push(v); return objects.length; };
  const catalog = push(''), pagesRoot = push(''), font = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs: number[] = [];
  const text = (x: number,y: number,value: unknown,size: number) =>
    `BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(value)}) Tj ET\n`;
  for (let page=1;page<=pages;page++) {
    let stream = '0 G 0 g\n';
    const render = testPage ? Array.from({length:8},(_,i)=>({page_number:1,sheet_position:i+1,equipment_id:'eqp-22222222',customer_name:'CALIBRATION',is_stock:0,po_number:'TEST',type_name:'TEST',ordered_model:'Avery 5821',requested_by_name:'',expected_date:null,unit_index:null,ordered_qty:null,label_print_id:''} as EquipmentLabel))
      : labels.filter(item=>item.page_number===page);
    for(const label of render) {
      const p=label.sheet_position-1;
      if(p<0||p>7) throw new Error('Invalid label position');
      const x=p%2===0?AVERY_5821.left:AVERY_5821.right;
      const y=AVERY_5821.pageH-AVERY_5821.top-AVERY_5821.labelH-Math.floor(p/2)*AVERY_5821.rowStep;
      // Bold monochrome-safe band, legible on standard printer stock.
      stream += `0.5 w ${x} ${y} 288 180 re S\n`;
      // Customer labels are maroon with white type; STOCK labels are gold with dark type.
      stream += label.is_stock ? '0.788 0.659 0.298 rg\n' : '0.420 0.102 0.173 rg\n';
      stream += `${x+5} ${y+146} 278 29 re f\n`;
      stream += label.is_stock ? '0 g\n' : '1 g\n';
      const headerText=fittedLabelText(label.is_stock?'STOCK':label.customer_name,260,14,9);
      stream += text(x+10,y+156,headerText.value,headerText.size);
      stream += '0 g\n';
      const poText=fittedLabelText('PO: '+clean(label.po_number,120),177,11,8);
      stream += text(x+9,y+125,poText.value,poText.size);
      stream += text(x+9,y+105,trim(label.type_name,25),11);
      const modelText=fittedLabelText('Model: '+clean(label.ordered_model,100),177,10,8);
      stream += text(x+9,y+88,modelText.value,modelText.size);
      stream += text(x+9,y+68,'Requested: '+trim(label.requested_by_name,25),9);
      stream += text(x+9,y+52,'Expected: '+trim(label.expected_date,14),9);
      stream += text(x+9,y+26,'Serial: ______________________',10);
      if(label.ordered_qty)stream += text(x+9,y+11,`Unit ${label.unit_index} of ${label.ordered_qty}`,8);
      if(testPage) {
        stream += text(x+192,y+78,'1 inch',10);
        stream += `0.7 w ${x+193} ${y+3} 72 72 re S\n`;
      }else {
        const qr=qrcode(0,'M'); qr.addData(label.equipment_id); qr.make();
        const count=qr.getModuleCount(),side=77,cell=side/(count+8),baseX=x+196,baseY=y+40;
        stream += '0 g\n';
        for(let row=0;row<count;row++)for(let col=0;col<count;col++){
          if(qr.isDark(row,col))stream += `${(baseX+(col+4)*cell).toFixed(3)} ${(baseY+(count-row+3)*cell).toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re f\n`;
        }
        stream += text(x+193,y+24,label.equipment_id,9);
      }
    }
    const streamBytes=encoded(stream);
    const contentId=push(`<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`);
    const pageId=push(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageRefs.push(pageId);
  }
  objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot-1]=`<< /Type /Pages /Kids [${pageRefs.map(id=>id+' 0 R').join(' ')}] /Count ${pages} >>`;
  let raw='%PDF-1.4\n';
  const offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(encoded(raw).length);
    raw+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=encoded(raw).length;
  raw+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))raw+=String(offset).padStart(10,'0')+' 00000 n \n';
  raw+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([encoded(raw)],{type:'application/pdf'});
}
