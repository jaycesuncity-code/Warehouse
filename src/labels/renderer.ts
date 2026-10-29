/** Adapt the preserved renderer at build time. Fail loudly if its integration anchors change. */
export function integratedRenderer(source:string):string {
 const replace=(a:string,b:string)=>{if(!source.includes(a))throw new Error('Label renderer integration anchor missing');source=source.replace(a,b);};
 replace('function newId(taken) {','function newId(taken) { throw new Error("Part IDs must come from the warehouse API");');
 replace("$('#btnGen').addEventListener('click', onGenerate);", "$('#btnGen').addEventListener('click', () => parent.dispatchEvent(new Event('warehouse-generate')));");
 replace("$('#btnDlPdf').addEventListener('click', () => { if (window.__lastPdfBlob) download(window.__lastPdfBlob, `bin-labels_${stamp()}.pdf`); });", "$('#btnDlPdf').hidden=true;");
 replace("$('#btnDlCsv').addEventListener('click', downloadCsv);", "$('#btnDlCsv').hidden=true;");
 replace("$('#btnDlXlsx').addEventListener('click', downloadXlsx);", "$('#btnDlXlsx').hidden=true;");
 replace('window.__BLG = { S, geom,',`window.__BLG = { S, geom,
    refresh: fullRefresh,
    invalidate() { if(gen.url) URL.revokeObjectURL(gen.url); gen.url=null; $('#pdfFrame').removeAttribute('src'); $('#lnkPdf').removeAttribute('href'); },
    async renderConfirmed(list) {
      if(gen.busy) throw new Error('PDF generation already running');
      const snapshot=structuredClone(list), g=geom();
      if(!snapshot.length || !g.fits) throw new Error('Check the selected rows and sheet margins');
      for(const row of snapshot) {
        if(!ID_RE.test(row.id) || !row.name.trim()) throw new Error('Confirmed ID and name required');
        const n=modsFor(row.id.length), ci=codeInfo(row.code,n);
        if(footprint(n)>S.labelH-0.01 || !ci.ok || !fitFor(normalizeText(row.name).text,n,ci.reserve).ok) throw new Error('Selected label does not fit; adjust the sheet settings or text');
      }
      gen.busy=true;
      try { const blob=await buildLabelPdf(snapshot,()=>{}); showPdf(blob); return blob; }
      finally { gen.busy=false; }
    },`);
 // Prevent unsafe ID actions, including keyboard activation, at the event boundary.
 replace('function wire() {',`function wire() {
   document.addEventListener('click', e => {
     if(e.target.closest('[data-act=newid],[data-act=keep],#bulkInvalid')) {e.preventDefault();e.stopImmediatePropagation();}
   },true);`);
 return source;
}
