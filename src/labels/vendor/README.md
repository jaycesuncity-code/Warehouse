# Spreadsheet parser used by the integrated label editor

`xlsx-0.20.3.min.js.txt` is the unmodified official SheetJS Community Edition
0.20.3 full browser distribution. Vite imports it as local source for the existing
label-renderer frame. There is no CDN request at runtime. The original standalone
HTML remains unchanged as a historical reference.

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
- Official guidance: https://docs.sheetjs.com/docs/getting-started/installation/standalone/
- Retrieved: 2026-10-29
- Size: 951,904 bytes
- SHA-256: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`
- License: Apache 2.0, retained in `SHEETJS-LICENSE.txt`

The integrated renderer removes the reference's 0.18.5 spreadsheet script and
uses this pinned release. The old public npm `xlsx` release is not an appropriate
upgrade source; see https://docs.sheetjs.com/docs/getting-started/installation/nodejs/.
The official release fixes the old parser's prototype pollution and ReDoS issues.
Imports are bounded to 16 MB, 10,000 rows and 256 columns. Macros are not loaded or
executed. Column values are treated as data; exported XLSX cells are strings.
