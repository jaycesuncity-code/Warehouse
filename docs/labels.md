# Parts to labels

The `/labels/` route uses the same catalog API and canonical `part_id` values as
the scanner and map. The historical standalone generator is retained unchanged
at `labels/bin-label-generator.html`; its Git blob remains
`1d1d9fdde57a8d6674cdf8cc015593aeb4274d45`.

## Workflow

1. Add a part manually, paste tabular text, import CSV/TSV/Excel/ODS, or search the
   warehouse catalog for an existing part. Imports append to the existing draft.
   Review the column mapping. Unmapped fields, empty columns, leading-zero SKUs
   and extra-column whitespace are retained.
2. Select the rows to process. **Register selected** explicitly registers new
   parts or matches existing SKU/name pairs. SKU and name are required. Duplicate
   selected SKUs, invalid/imported mismatched IDs and conflicting catalog names
   are reported per row. Registration is sent in batches of at most 100 rows.
3. Successful rows keep their server-confirmed IDs when other rows fail. Correct
   or deselect the failed rows and retry. A lost response can be retried: the
   backend's unique SKU match returns the original ID instead of creating a
   second part. A saved record is read back before it is marked verified.
4. **Generate labels** performs read-only catalog verification and builds a PDF
   for the selected verified rows. It does not create parts and does not change
   inventory. Viewers can reprint existing parts; only authorized editors/admins
   can register new parts. Backend authorization remains the security boundary.
5. Preview the PDF in the editor, download it, or use **Open / print PDF**. Export
   verified selected records as CSV/XLSX, including successful rows from a
   partially completed batch. Export the entire draft as XLSX before leaving a
   browser where local storage is unavailable.

Draft rows and selections are saved locally under separate demo/live keys. A
restored or imported ID is always verified again before printing. Changing a
selected row, selection or sheet setting invalidates the previous PDF, preview
and open/print link. No polling or replacement of the editor's complete row list
is used during PDF generation.

## Printing and identity

- QR contents are exactly the backend-confirmed canonical `part_id`, matching
  `^prt-[2-9a-hj-km-np-z]{8}$`. No URL, SKU, stock quantity or location is encoded.
- The default PDF is US Letter, 612 × 792 points. It uses 2 columns × 11 rows,
  22 labels per sheet, and 2.95 × 0.84 inch labels. The default row gap is 0.035
  inch and column gap 0.1 inch. The label grid is centered.
- Skipped positions apply only to the first sheet. Subsequent sheets begin at
  position one. The sheet-position preview and page count reflect only selected
  rows. Duplicate canonical IDs in one selected PDF are rejected.
- Printing requires **100% / Actual size**. The retained test page has a 1-inch
  measurement square. Software tests verify PDF coordinates and QR decoding;
  they do **not** establish accuracy on a physical printer. Measure a test page
  on the actual printer before printing the full batch.
- Expected quantity stays in draft/export records; it is never posted to stock.

## Spreadsheet handling

The integrated editor removes the original embedded SheetJS 0.18.5 parser and
uses the pinned official SheetJS CE 0.20.3 distribution from a local vendored
asset. The Apache 2.0 license, source URL and SHA-256 are recorded in
`src/labels/vendor/README.md`. No parser is downloaded at runtime. Imports are
limited to 16 MB, 10,000 data rows and 256 columns. Malformed quoted CSV is
reported explicitly and cannot leave a previous import mapping active.

XLSX export writes values as strings and preserves their original content.
CSV export prefixes formula-like values with an apostrophe so spreadsheet apps
open them as text; use XLSX when exact original cell values must round-trip.
Extra-column names and values are displayed as escaped text, not executable HTML.

## Verification

Run `npm test -- src/labels` for resolver, export, renderer, pinned-source,
malformed-input and PDF checks. The PDF checks inspect actual compressed content
streams, verify the Letter MediaBox and label rectangles, rasterize their vector
QR marks, and decode each with the scanner's `jsqr` decoder. They cover 23 labels
with two skipped positions, yielding 20 labels on the first sheet and three on
the second.

Run `npm run test:e2e -- e2e/labels.spec.ts` for real-browser manual entry,
selected-only registration, PDF download and scanner roundtrip, partial failures
and retries, CSV upload/paste/XLSX reimport, stale output invalidation, restored
drafts, viewer restrictions, and desktop/mobile layouts. On the implementation
workstation these checks used isolated demo builds and Chromium; no production
catalog or inventory was modified.
