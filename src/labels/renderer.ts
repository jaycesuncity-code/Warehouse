import spreadsheetSource from './vendor/xlsx-0.20.3.min.js.txt?raw';

/** Adapt the preserved renderer, failing closed if a required anchor changes. */
export function integratedRenderer(source: string): string {
  const replace = (before: string, after: string) => {
    if (!source.includes(before)) throw new Error('Label renderer integration anchor missing: '+before.slice(0,80));
    source = source.replace(before, after);
  };
  // The reference embeds obsolete SheetJS 0.18.5. Only the integrated experience
  // uses this pinned official release; the reference remains byte-for-byte intact.
  const parser = source.indexOf('e.version="0.18.5"');
  const start = source.lastIndexOf('<script>', parser);
  const end = source.indexOf('</script>', parser);
  if (parser < 0 || start < 0 || end < 0) throw new Error('Spreadsheet library anchor missing');
  source = source.slice(0, start) + '<script>\n' + spreadsheetSource.replace(/<\/script/gi, '<\\/script') + '\n</script>' + source.slice(end + 9);

  replace('function newId(taken) {', 'function newId(taken) { throw new Error("Part IDs must come from the warehouse API");');
  replace("$('#btnGen').addEventListener('click', onGenerate);", "$('#btnGen').addEventListener('click', () => parent.dispatchEvent(new Event('warehouse-generate')));");
  replace("$('#btnDlPdf').addEventListener('click', () => { if (window.__lastPdfBlob) download(window.__lastPdfBlob, `bin-labels_${stamp()}.pdf`); });", "$('#btnDlPdf').hidden=true;");
  replace("$('#btnDlCsv').addEventListener('click', downloadCsv);", "$('#btnDlCsv').hidden=true;");
  replace("$('#btnDlXlsx').addEventListener('click', downloadXlsx);", "$('#btnDlXlsx').hidden=true;");
  replace('let stats = {};', `let stats = {};
let selectedKeys = null;
const printingCount = () => selectedKeys === null ? rows.length : rows.filter(row => selectedKeys.has(row.k)).length;`);
  replace('pages: N ? Math.ceil((S.skip + N) / g.perPage) : 0', 'pages: printingCount() ? Math.ceil((S.skip + printingCount()) / g.perPage) : 0');
  replace("`${stats.total} label${stats.total === 1 ? '' : 's'} ->", "`${printingCount()} selected label${printingCount() === 1 ? '' : 's'} ->");
  replace('p - S.skip < stats.total', 'p - S.skip < printingCount()');
  replace("`${stats.total} label${stats.total === 1 ? '' : 's'} on", "`${printingCount()} selected label${printingCount() === 1 ? '' : 's'} on");
  // Bound imports and preserve original extra-column values instead of trimming them.
  replace('async function readFileSheets(file) {', `async function readFileSheets(file) {
  if(file.size>16*1024*1024) throw new Error('Maximum file size is 16 MB. Split the spreadsheet and retry.');`);
  replace("{ type: 'array' });\n    return wb.SheetNames.map", "{ type: 'array', sheetRows: 10002, bookVBA: false });\n    return wb.SheetNames.map");
  replace('function parseDelimited(text, d) {', `function parseDelimited(text, d) {
  if(text.length>16*1024*1024) throw new Error('Maximum pasted data is 16 MB. Split the list and retry.');`);
  replace("if (q) return text.split(/\\r\\n|\\n|\\r/).map(l => l.split(d));", "if (q) throw new Error('Unclosed quote in the CSV. Correct the source data and retry.');");
  replace("function reparsePaste() {\n  const text", "function reparsePaste() {\n  imp=null; renderImport();\n  try {\n  const text");
  replace("startImport({ src: 'pasted list', kind: 'paste', sheets: [{ name: 'Pasted list', aoa }] });\n}", "startImport({ src: 'pasted list', kind: 'paste', sheets: [{ name: 'Pasted list', aoa }] });\n  } catch(error) { toast(error.message || 'Could not read the pasted data.', 'err'); }\n}");
  replace("async function onFile(file) {\n  $('#importMsg')", "async function onFile(file) {\n  imp=null; renderImport();\n  $('#importMsg')");
  replace('function cleanAoa(aoa) {', `function cleanAoa(aoa) {
  if(aoa.length>10001 || aoa.some(r => r && r.length>256)) throw new Error('Import at most 10,000 parts and 256 columns at a time.');`);
  replace("String(v).trim())).filter(r => r.some(c => c !== ''))", "String(v))).filter(r => r.some(c => c.trim() !== ''))");
  replace('const seen = {};\n    headers', 'const seen = Object.create(null);\n    headers');
  replace("let nm = h; if (CANON.indexOf(nm.toLowerCase()) >= 0)", "let nm = h.trim(); if (CANON.indexOf(nm.toLowerCase()) >= 0)");
  replace("ex: {}, keepInvalid: false", "ex: Object.create(null), keepInvalid: false");
  replace('const v = cell(cells, +ci); if (v) r.ex[colName[ci]] = v;', "const v = cells[+ci] == null ? '' : String(cells[+ci]); r.ex[colName[ci]] = v;");

  source = source.replaceAll('made for you if blank', 'confirmed by the warehouse')
    .replaceAll('placeholder="made for you"', 'placeholder="register to resolve"')
    .replaceAll('Used as-is if valid, otherwise made for you', 'Verified against the warehouse before printing')
    .replaceAll('Not printed - carried to the ID sheet', 'Required SKU; optionally printed below the name')
    .replaceAll('IDs to be made', 'IDs to resolve')
    .replaceAll('choose "Keep anyway" or "Replace".', 'correct the ID or clear it to match the database.')
    .replaceAll('ID sheet (for the database):', 'Confirmed label PDF:')
    .replace('Works offline &middot; nothing is uploaded anywhere', 'Draft editing stays in this browser &middot; registration and ID verification use the warehouse database')
    .replace('Label sizes are exact physical sizes.', 'The PDF uses the configured dimensions. Verify your printer with the test page.')
    .replace('Red rows must be fixed or deleted before the PDF can be made.', 'Correct or deselect problem rows before registering or printing them.');
  replace("if (!name) iss.push({ lv: 'error', msg: 'Part name is empty' });", "if (!r.code.trim()) iss.push({ lv: 'error', msg: 'SKU is required for database registration' });\n    if (!name) iss.push({ lv: 'error', msg: 'Part name is empty' });");
  // The parent's selected subset controls registration and printing, not every row.
  replace("$('#btnGen').disabled = why.length > 0 || gen.busy;", "$('#btnGen').disabled = gen.busy; $('#btnGen').textContent='Generate selected labels';");
  replace('if (opts && opts.grid) renderGrid(); else updateStatusCells();', "if (opts && opts.grid) renderGrid(); else updateStatusCells();\n  parent.dispatchEvent(new Event('warehouse-label-change'));");

  replace('window.__BLG = { S, geom,', `window.__BLG = { S, geom,
    get extraColumns() { return extraCols.slice(); },
    setSelection(keys) { selectedKeys=new Set(keys); validateAll(); renderStats(); renderSettingsInfo(); updateGenUi(); },
    refresh: fullRefresh,
    restoreDraft(list, columns) {
      rows=list.map((r,i)=>({...r,k:i+1,keepInvalid:false,iss:[]}));
      uid=rows.length+1; extraCols=Array.from(new Set(columns)); gridPage=0; fullRefresh();
    },
    invalidate() {
      if(gen.url) URL.revokeObjectURL(gen.url);
      gen.url=null; gen.done=false; gen.dirty=false; window.__lastPdfBlob=null;
      $('#pdfFrame').removeAttribute('src'); $('#pdfFrame').classList.add('hidden');
      $('#lnkPdf').removeAttribute('href'); $('#exportRow').classList.add('hidden'); $('#summary').classList.add('hidden');
    },
    async renderConfirmed(list) {
      if(gen.busy) throw new Error('PDF generation already running');
      const snapshot=structuredClone(list), g=geom();
      const range=(k,min,max)=>Number.isFinite(S[k])&&S[k]>=min&&S[k]<=max;
      if(![10,11,12].includes(S.rows) || !Number.isInteger(S.skip) || S.skip<0 || S.skip>=g.perPage
        || !range('labelW',1,8)||!range('labelH',.3,5)||!range('margin',0,2)
        || !range('colGap',0,2)||!range('rowGap',0,1)||!range('module',.01,.1))
        throw new Error('Invalid sheet settings. Reset to defaults and try again.');
      if(!snapshot.length || !g.fits) throw new Error('Check the selected rows and sheet margins');
      const ids=new Set();
      for(const row of snapshot) {
        if(!ID_RE.test(row.id) || !row.name.trim() || !row.code.trim()) throw new Error('Confirmed ID, SKU and name required');
        if(ids.has(row.id)) throw new Error('Duplicate part ID in selected labels');
        ids.add(row.id);
        const n=modsFor(row.id.length), ci=codeInfo(row.code,n);
        if(footprint(n)>S.labelH-0.01 || !ci.ok || !fitFor(normalizeText(row.name).text,n,ci.reserve).ok)
          throw new Error('Selected label does not fit; adjust the sheet settings or text');
      }
      gen.busy=true;
      try {
        const blob=await buildLabelPdf(snapshot,()=>{});
        gen.done=true; gen.dirty=false; window.__lastPdfBlob=blob; showPdf(blob);
        $('#summary').textContent=snapshot.length+' verified label(s), '+Math.ceil((S.skip+snapshot.length)/g.perPage)+' US Letter sheet(s). Print at 100% / Actual size.';
        $('#summary').classList.remove('hidden'); $('#exportRow').classList.remove('hidden');
        return blob;
      } finally { gen.busy=false; }
    },`);
  replace('function wire() {', `function wire() {
    document.addEventListener('click', e => {
      if(e.target.closest('[data-act=newid],[data-act=keep],#bulkInvalid')) {e.preventDefault();e.stopImmediatePropagation();}
    },true);`);
  replace('</head>', `<style>
    :root{--maroon:#892634;--maroon-dark:#6d1e2a;--radius:6px}
    header.top,footer.bottom,#bulkInvalid,button[data-act=newid],button[data-act=keep],#exportWhy,#why,#stale{display:none!important}
    main.wrap{padding:12px 0 0}.wrap{max-width:none}.card{box-shadow:none}
    #btnExample{display:none}#oneCode{border-color:var(--maroon)}
    @media(max-width:600px){.card{padding:16px 12px}.grid2,.settings,#oneForm .settings{grid-template-columns:1fr!important}.adv-grid,.map-grid{grid-template-columns:1fr 1fr}.tab{padding:10px 12px;font-size:14px}.drop{padding:16px 12px}iframe.pdf{height:560px}}
  </style></head>`);
  return source;
}
