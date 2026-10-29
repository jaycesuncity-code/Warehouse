import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isPartId } from "../../shared/ids";
import { ScannerDialog } from "../../shared/scanner/ScannerDialog";
import { COLOR_BY_LABEL, type ColorBy } from "../colors";
import { exportSnapshot, importSnapshot, parseSnapshot, redo, runSearch, select, showDialog, undo } from "../actions";
import { PRESETS, type PresetKey } from "../presets";
import { groupResults } from "../search";
import { canEdit, isAdmin, setMap, toast, useMap, type ViewMode } from "../store";
import type { SnapGrid } from "../geometry";

const LEVEL_TEXT = {
  idle: "",
  none: "No results",
  unplaced: "Found, but not on a shelf yet",
  floor: "Matches on several shelves",
  shelf: "All matches are on one shelf",
  slot: "Found it",
} as const;

export function SearchBox({ autoFocus }: { autoFocus?: boolean }) {
  const q = useMap((s) => s.search.q);
  const [text, setText] = useState(q);
  const [scan, setScan] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number>(0);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  // "/" focuses the search box; a keyboard-wedge scan typed anywhere is routed here.
  useEffect(() => {
    let buf = "";
    let lastAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        input.current?.focus();
        return;
      }
      const now = performance.now();
      if (now - lastAt > 80) buf = "";
      lastAt = now;
      if (e.key === "Enter" && isPartId(buf)) {
        e.preventDefault();
        setText(buf);
        void runSearch(buf);
        buf = "";
      } else if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const change = (v: string) => {
    setText(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void runSearch(v), isPartId(v.trim()) ? 0 : 160);
  };
  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <span className="pointer-events-none absolute left-2.5 text-gray-400" aria-hidden>
        🔍
      </span>
      <input
        ref={input}
        data-testid="map-search"
        type="text"
        role="searchbox"
        inputMode="search"
        autoComplete="off"
        className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-8 pr-20 text-[15px] shadow-inner focus:border-maroon focus:outline-none"
        placeholder="Find a part: name, code, category, or scan"
        aria-label="Search parts on the map"
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            window.clearTimeout(timer.current);
            void runSearch(text);
          }
          if (e.key === "Escape") {
            change("");
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {text && (
        <button
          className="absolute right-11 px-1 text-lg text-gray-400 hover:text-gray-700"
          aria-label="Clear search"
          onClick={() => change("")}
        >
          ×
        </button>
      )}
      <button
        className="absolute right-1 rounded-md px-2 py-1 text-lg hover:bg-gray-100"
        aria-label="Scan a part label"
        title="Scan a part label"
        onClick={() => setScan(true)}
        data-testid="scan-button"
      >
        📷
      </button>
      <ScannerDialog
        open={scan}
        onClose={() => setScan(false)}
        onPartId={(id) => {
          setScan(false);
          setText(id);
          void runSearch(id);
        }}
      />
    </div>
  );
}

/** Grouped result list (zone -> shelf -> slots) with the zoom-level status line. */
export function SearchResults({ compact }: { compact?: boolean }) {
  const search = useMap((s) => s.search);
  const layout = useMap((s) => s.layout);
  const { groups, unplaced } = useMemo(() => {
    const info = new Map(
      (layout?.shelves ?? []).map((s) => [s.shelf_id, { name: s.name, zoneName: s.zone_name ?? "No zone" }]),
    );
    return groupResults(search.items, info);
  }, [search.items, layout]);
  if (search.focus.level === "idle" && search.status !== "loading") return null;
  return (
    <div className={`overflow-auto ${compact ? "" : "max-h-[50vh]"}`} data-testid="search-results">
      <div
        className={`px-3 py-2 text-sm font-semibold ${search.focus.level === "none" ? "text-red-700" : "text-gray-800"}`}
        data-testid="search-status"
        data-level={search.focus.level}
      >
        {search.status === "loading"
          ? "Searching…"
          : search.status === "error"
            ? `Search failed: ${search.error}`
            : LEVEL_TEXT[search.focus.level]}
        {search.status === "done" && search.items.length > 0 && (
          <span className="ml-1 font-normal text-gray-500">
            · {search.total} part{search.total === 1 ? "" : "s"}
            {search.focus.shelfIds.length > 0 &&
              `, ${search.focus.shelfIds.length} shelf${search.focus.shelfIds.length === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.zoneName} className="border-t border-gray-100">
          <div className="bg-gray-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-600">
            {g.zoneName}
          </div>
          {g.shelves.map((s) => (
            <div key={s.shelfId} className="px-2 py-1">
              <button
                className="w-full rounded px-1 text-left text-xs font-bold text-maroon hover:underline"
                onClick={() => select({ kind: "shelf", id: s.shelfId }, { fly: true, front: true })}
              >
                Shelf {s.shelfName}
              </button>
              {s.entries.map((e) => (
                <button
                  key={`${e.partId}-${e.slotId}`}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm hover:bg-maroon-tint"
                  data-testid="result-entry"
                  onClick={() => {
                    select({ kind: "slot", shelfId: s.shelfId, id: e.slotId }, { fly: true, front: true });
                    setMap({ partCardId: e.partId });
                  }}
                >
                  <span className="font-mono text-xs font-bold text-gray-700">{e.locationCode}</span>
                  <span className="min-w-0 flex-1 truncate">{e.partName}</span>
                  <span className="font-mono text-[11px] text-gray-500">{e.partCode}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
      {unplaced.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="bg-gray-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-600">
            Not on a shelf yet
          </div>
          {unplaced.map((p) => (
            <button
              key={p.part_id}
              className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-sm hover:bg-maroon-tint"
              onClick={() => setMap({ partCardId: p.part_id })}
            >
              <span className="min-w-0 flex-1 truncate">{p.part_name}</span>
              <span className="font-mono text-[11px] text-gray-500">{p.part_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  testId,
  disabled,
}: {
  value: T;
  options: { v: T; label: string; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex overflow-hidden rounded-lg border border-gray-300 bg-white"
      role="radiogroup"
      data-testid={testId}
    >
      {options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          title={o.title}
          disabled={disabled || o.disabled}
          data-testid={testId ? `${testId}-${o.v}` : undefined}
          className={`px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${value === o.v ? "bg-maroon text-white" : "text-gray-700 hover:bg-gray-100"}`}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ViewToggle() {
  const view = useMap((s) => s.view);
  return (
    <Seg<ViewMode>
      testId="view"
      value={view}
      onChange={(v) => setMap({ view: v })}
      options={[
        { v: "plan", label: "Plan", title: "Top-down plan" },
        { v: "orbit", label: "3D", title: "3D orbit" },
        { v: "walk", label: "Walk", title: "Walk through (first person)" },
      ]}
    />
  );
}

export function SaveState() {
  const saving = useMap((s) => s.saving);
  const failed = useMap((s) => s.failed.length);
  const offline = useMap((s) => s.offline);
  const last = useMap((s) => s.lastSavedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);
  let text = "Saved";
  let cls = "text-emerald-700";
  if (saving) {
    text = "Saving…";
    cls = "text-gray-600";
  } else if (failed) {
    text = `${failed} not saved`;
    cls = "text-red-700 font-bold";
  } else if (offline) {
    text = "Offline";
    cls = "text-red-700 font-bold";
  } else if (!last) {
    text = "Up to date";
    cls = "text-gray-500";
  }
  return (
    <span className={`whitespace-nowrap text-xs ${cls}`} data-testid="save-state" aria-live="polite">
      {saving ? "⏳" : failed || offline ? "⚠" : "✓"} {text}
    </span>
  );
}

export function TopBar({ compact }: { compact?: boolean }) {
  const s = useMap(
    useShallow((st) => ({
      me: st.me,
      editMode: st.editMode,
      snap: st.snap,
      snapEdges: st.snapEdges,
      colorBy: st.colorBy,
      unverifiedOnly: st.unverifiedOnly,
      undoStack: st.undoStack,
      redoStack: st.redoStack,
      viewOpts: st.viewOpts,
      zones: st.layout?.zones,
      surveyInput: st.surveyInput,
      warnCfg: st.warnCfg,
    })),
  );
  const editor = canEdit(s);
  const admin = isAdmin(s);
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editToggle = (
    <Seg<"view" | "edit">
      testId="mode"
      value={s.editMode && editor ? "edit" : "view"}
      onChange={(v) => setMap({ editMode: v === "edit", tool: null })}
      options={[
        { v: "view", label: "View" },
        {
          v: "edit",
          label: "Edit",
          disabled: !editor,
          title: editor ? "Place shelves, rows, slots, bins and parts" : "Editing needs the editor role",
        },
      ]}
    />
  );
  const snapControls = (
    <>
      <select
        className="field !w-auto !py-1 text-xs"
        value={s.snap}
        onChange={(e) => setMap({ snap: Number(e.target.value) as SnapGrid })}
        data-testid="snap"
        aria-label="Snap"
        title="Snap while moving shelves"
      >
        <option value={0}>Snap off</option>
        <option value={1}>Snap 1 in</option>
        <option value={6}>Snap 6 in</option>
        <option value={12}>Snap 1 ft</option>
      </select>
      <label
        className="flex items-center gap-1 text-xs text-gray-700"
        title="Also snap to walls and other shelves' edges and backs"
      >
        <input type="checkbox" checked={s.snapEdges} onChange={(e) => setMap({ snapEdges: e.target.checked })} /> edges
      </label>
    </>
  );
  const controls = (
    <>
      <select
        className="field !w-auto !py-1 text-xs"
        value={s.colorBy}
        onChange={(e) => setMap({ colorBy: e.target.value as ColorBy })}
        data-testid="color-by"
        aria-label="Color by"
        title="Color bins by"
      >
        {(Object.keys(COLOR_BY_LABEL) as ColorBy[]).map((k) => (
          <option key={k} value={k}>
            Color: {COLOR_BY_LABEL[k]}
          </option>
        ))}
      </select>
      <button
        className={`btn-sm btn ${s.unverifiedOnly ? "bg-amber-500 text-ink" : "btn-ghost"}`}
        aria-pressed={s.unverifiedOnly}
        onClick={() => setMap({ unverifiedOnly: !s.unverifiedOnly })}
        data-testid="unverified-filter"
        title="Highlight rooms, openings and shelves not tape-checked yet"
      >
        Unverified
      </button>
    </>
  );
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-2 py-1.5"
      data-testid="top-bar"
    >
      <div className="flex min-w-[240px] flex-1 items-center">
        <SearchBox autoFocus />
      </div>
      <ViewToggle />
      {editToggle}
      {!compact && controls}
      {s.editMode && editor && !compact && snapControls}
      {s.editMode && editor && <AddShelfButton />}
      <div className="flex items-center gap-1">
        <button
          className="btn-ghost btn-sm"
          disabled={!s.undoStack.length}
          onClick={() => void undo()}
          title={s.undoStack.length ? `Undo: ${s.undoStack[s.undoStack.length - 1].label} (Ctrl+Z)` : "Nothing to undo"}
          data-testid="undo"
        >
          ↶
        </button>
        <button
          className="btn-ghost btn-sm"
          disabled={!s.redoStack.length}
          onClick={() => void redo()}
          title={s.redoStack.length ? `Redo: ${s.redoStack[s.redoStack.length - 1].label} (Ctrl+Y)` : "Nothing to redo"}
          data-testid="redo"
        >
          ↷
        </button>
      </div>
      <SaveState />
      <div className="relative">
        <button
          className="btn-ghost btn-sm"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
          data-testid="more-menu"
        >
          ⋯
        </button>
        {menu && (
          <div
            className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-xl"
            onMouseLeave={() => setMenu(false)}
          >
            {compact && (
              <div className="mb-2 flex flex-wrap items-center gap-2 border-b pb-2">
                {controls}
                {s.editMode && editor && snapControls}
              </div>
            )}
            <div className="field-label">View options</div>
            {(
              [
                ["cutaway", "Wall cutaway (3' walls)"],
                ["xray", "X-ray walls"],
                ["hideEmpty", "Hide empty slots"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={s.viewOpts[k]}
                  onChange={(e) => setMap({ viewOpts: { ...s.viewOpts, [k]: e.target.checked } })}
                />{" "}
                {label}
              </label>
            ))}
            <label className="mt-1 block">
              <span className="field-label">Isolate one zone</span>
              <select
                className="field"
                value={s.viewOpts.isolateZone ?? ""}
                onChange={(e) => setMap({ viewOpts: { ...s.viewOpts, isolateZone: e.target.value || null } })}
                data-testid="isolate-zone"
              >
                <option value="">All zones</option>
                {s.zones?.map((z) => (
                  <option key={z.zone_id} value={z.zone_id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={s.surveyInput}
                onChange={(e) => setMap({ surveyInput: e.target.checked })}
                data-testid="survey-toggle"
              />{" "}
              Enter Y from survey sheet
            </label>
            <div className="field-label mt-2">Warnings</div>
            <label className="flex items-center justify-between gap-2 py-0.5 text-xs">
              Min aisle (in)
              <input
                className="field !w-20"
                type="number"
                min={12}
                value={s.warnCfg.minAisleIn}
                onChange={(e) => setMap({ warnCfg: { ...s.warnCfg, minAisleIn: Number(e.target.value) || 36 } })}
              />
            </label>
            <label className="flex items-center justify-between gap-2 py-0.5 text-xs">
              High-pile reminder above (in)
              <input
                className="field !w-20"
                type="number"
                min={24}
                value={s.warnCfg.highPileIn}
                onChange={(e) => setMap({ warnCfg: { ...s.warnCfg, highPileIn: Number(e.target.value) || 144 } })}
              />
            </label>
            <div className="field-label mt-2">Layout snapshot</div>
            <button className="btn-ghost btn-sm w-full" onClick={() => exportSnapshot()} data-testid="export-snapshot">
              Export layout snapshot (JSON)
            </button>
            {admin && (
              <>
                <button className="btn-ghost btn-sm mt-1 w-full" onClick={() => fileRef.current?.click()}>
                  Import snapshot… (admin)
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    try {
                      const snap = parseSnapshot(await f.text());
                      showDialog({
                        kind: "confirm",
                        title: "Import layout snapshot?",
                        message: `This replays ${snap.zones.length} zones, ${snap.openings.length} openings and ${snap.shelves.length} shelves through the API, changing positions and sizes to match the file. Part locations are not changed. Every change is recorded and can be undone one by one in the history.`,
                        confirmLabel: "Import",
                        danger: true,
                        onConfirm: async () => {
                          const r = await importSnapshot(snap);
                          toast(
                            r.failed.length
                              ? `Imported ${r.ok}; ${r.failed.length} failed: ${r.failed.slice(0, 2).join("; ")}`
                              : `Imported ${r.ok} items`,
                            r.failed.length ? "warn" : "success",
                          );
                        },
                      });
                    } catch (err) {
                      toast(err instanceof Error ? err.message : String(err), "error");
                    }
                  }}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AddShelfButton() {
  const tool = useMap((s) => s.tool);
  const [preset, setPreset] = useState<PresetKey>("last");
  const active = tool?.kind === "add-shelf";
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-maroon">
      <button
        className={`px-2.5 py-1.5 text-xs font-bold ${active ? "bg-gold text-ink" : "bg-maroon text-white hover:bg-maroon-light"}`}
        onClick={() =>
          setMap({
            tool: active ? null : { kind: "add-shelf", preset },
            view: useMap.getState().view === "walk" ? "plan" : useMap.getState().view,
          })
        }
        data-testid="add-shelf"
        aria-pressed={active}
      >
        + Add shelf
      </button>
      <select
        className="w-28 border-l border-maroon bg-white px-1 py-1.5 text-xs"
        value={preset}
        aria-label="Shelf preset"
        data-testid="add-shelf-preset"
        onChange={(e) => {
          const p = e.target.value as PresetKey;
          setPreset(p);
          if (active) setMap({ tool: { kind: "add-shelf", preset: p } });
        }}
      >
        <option value="last">Last used size</option>
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
          <option key={k} value={k}>
            {PRESETS[k].label}
          </option>
        ))}
      </select>
    </div>
  );
}
