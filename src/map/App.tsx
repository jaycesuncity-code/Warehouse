import { DemoBadge } from "../shared/ui/Header";
import { useEffect, useState } from "react";
import { api } from "../shared/api";
import { DemoControls, Header, RoleBadge } from "../shared/ui";
import {
  applyDeepLink,
  assignPart,
  deleteShelf,
  duplicateShelf,
  fitAll,
  loadLayout,
  loadMe,
  redo,
  retryAllFailed,
  rotateShelf,
  undo,
} from "./actions";
import { MapCanvas } from "./scene/Scene";
import { EquipmentMapPanel } from "./scene/EquipmentMarkers";
import { LabelLayer } from "./scene/labels";
import { dropPicker } from "./scene/DropPicker";
import { DialogHost, FailedEdits, ToastBridge } from "./ui/Dialogs";
import { FrontView } from "./ui/FrontView";
import { GraphicsBoundary } from "./ui/GraphicsBoundary";
import { Inspector } from "./ui/Inspector";
import { LeftPanel, PartsPanel, readPartDrag, TreePanel } from "./ui/LeftPanel";
import { PartCard } from "./ui/PartCard";
import { SearchResults, TopBar } from "./ui/TopBar";
import { CursorReadout, Legend, NorthArrow, ToolHint, useLabels } from "./ui/ViewportOverlays";
import { canEdit, editing, getMap, selectedShelfId, setMap, toast, useMap, type MobilePanel } from "./store";

function useMedia(q: string) {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
      const s = getMap();
      const ctrl = e.ctrlKey || e.metaKey;
      const shelfId = selectedShelfId(s.selection);
      if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if (ctrl && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        void redo();
      } else if (e.key === "Escape") {
        if (s.tool) setMap({ tool: null });
        else if (s.dialog) return;
        else if (s.view !== "walk") setMap({ selection: null, frontViewOpen: false });
      } else if (e.key.toLowerCase() === "f" && !ctrl && s.view !== "walk") {
        fitAll();
      } else if (editing(s) && shelfId && !shelfId.startsWith("tmp-") && s.view !== "walk") {
        if (e.key.toLowerCase() === "r" && !ctrl) {
          e.preventDefault();
          void rotateShelf(shelfId, e.shiftKey ? 15 : 90);
        } else if (ctrl && e.key.toLowerCase() === "d") {
          e.preventDefault();
          void duplicateShelf(shelfId);
        } else if ((e.key === "Delete" || e.key === "Backspace") && s.selection?.kind === "shelf") {
          e.preventDefault();
          deleteShelf(shelfId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useBoot() {
  useEffect(() => {
    let done = false;
    (async () => {
      await loadMe();
      const ok = await loadLayout(true);
      if (done) return;
      const params = new URLSearchParams(window.location.search);
      const linked = ok && (await applyDeepLink(params));
      if (!linked) fitAll();
    })();
    const onFocus = () => void loadLayout();
    window.addEventListener("focus", onFocus);
    return () => {
      done = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  // offline: keep retrying, then resend failed edits
  const offline = useMap((s) => s.offline);
  useEffect(() => {
    if (!offline) return;
    const t = setInterval(async () => {
      try {
        await api.me();
        setMap({ offline: false, loadError: null });
        if (!getMap().layout) await loadLayout(true);
        if (getMap().failed.length) {
          toast("Back online. Saving your edits…", "info");
          await retryAllFailed();
        }
      } catch {
        /* still offline */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [offline]);
}

function Viewport({ showResults }: { showResults: boolean }) {
  const labels = useLabels();
  const layout = useMap((s) => s.layout);
  const loadError = useMap((s) => s.loadError);
  const searchActive = useMap((s) => s.search.focus.level !== "idle" || s.search.status === "loading");
  const [resultsOpen, setResultsOpen] = useState(true);
  useEffect(() => setResultsOpen(true), [searchActive]);
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden"
      data-testid="viewport"
      onDragOver={(e) => {
        if (editing(getMap())) e.preventDefault();
      }}
      onDrop={(e) => {
        const p = readPartDrag(e);
        if (!p || !editing(getMap())) return;
        e.preventDefault();
        const hit = dropPicker.pick(e.clientX, e.clientY);
        if (!hit) return toast("Drop the part onto a bin on a shelf.", "info");
        void assignPart(
          { part_id: p.part_id, part_name: p.part_name },
          hit.slotId,
          p.from_slot_id ? { from_slot_id: p.from_slot_id } : { mode: "add", par_qty: 0, on_hand_qty: 0 },
        );
      }}
    >
      <GraphicsBoundary>
        <MapCanvas />
        <EquipmentMapPanel />
        <LabelLayer labels={labels} />
        <CursorReadout />
        <NorthArrow />
        <Legend />
        <ToolHint />
      </GraphicsBoundary>
      <FailedEdits />
      {showResults && searchActive && (
        <div className="absolute left-2 top-2 z-20 w-80 max-w-[calc(100%-5rem)] rounded-lg border border-gray-200 bg-white/95 shadow-xl">
          <button
            className="flex w-full items-center px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-500"
            onClick={() => setResultsOpen(!resultsOpen)}
          >
            Search results <span className="ml-auto">{resultsOpen ? "▾" : "▸"}</span>
          </button>
          {resultsOpen && <SearchResults />}
        </div>
      )}
      {!layout && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-surface/80">
          <div className="rounded-xl bg-white p-6 text-center shadow-xl" data-testid="loading">
            {loadError ? (
              <>
                <p className="font-bold text-red-700">Couldn't load the map</p>
                <p className="mt-1 text-sm">{loadError}</p>
                <button className="btn-primary mt-3" onClick={() => void loadLayout(true)}>
                  Try again
                </button>
              </>
            ) : (
              <p className="font-semibold text-gray-700">Loading the shop…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const MOBILE_TABS: { id: Exclude<MobilePanel, null>; label: string }[] = [
  { id: "results", label: "Results" },
  { id: "inspector", label: "Details" },
  { id: "tree", label: "Layout" },
  { id: "parts", label: "Parts" },
];

function MobileShell() {
  const panel = useMap((s) => s.mobilePanel);
  const walking = useMap((s) => s.view === "walk");
  const front = useMap((s) => s.frontViewOpen && !!selectedShelfId(s.selection));
  const partCard = useMap((s) => s.partCardId);
  const level = useMap((s) => s.search.focus.level);
  const editor = useMap(canEdit);
  // open the results sheet when a search lands on the floor / no results
  useEffect(() => {
    if (level === "floor" || level === "none" || level === "unplaced") setMap({ mobilePanel: "results" });
    if (level === "shelf" || level === "slot") setMap({ mobilePanel: null });
  }, [level]);
  const sheet = walking ? null : (panel ?? (front ? "front" : partCard ? "card" : null));
  return (
    <>
      {sheet && (
        <div
          className={`relative z-30 flex shrink-0 flex-col rounded-t-2xl border-t border-gray-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,.15)] ${sheet === "front" ? "h-[56%]" : "max-h-[58%]"}`}
          data-testid={`sheet-${sheet}`}
        >
          <div className="flex items-center justify-center py-1">
            <button
              className="h-1.5 w-12 rounded-full bg-gray-300"
              aria-label="Close panel"
              onClick={() =>
                setMap(
                  sheet === "front"
                    ? { frontViewOpen: false }
                    : sheet === "card"
                      ? { partCardId: null }
                      : { mobilePanel: null },
                )
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {sheet === "front" && (
              <div className="flex h-full flex-col">
                <PartCard />
                <div className="min-h-[260px] flex-1">
                  <FrontView onClose={() => setMap({ frontViewOpen: false })} />
                </div>
              </div>
            )}
            {sheet === "card" && <PartCard />}
            {sheet === "results" && <SearchResults compact />}
            {sheet === "inspector" && (
              <>
                <PartCard />
                <Inspector />
              </>
            )}
            {sheet === "tree" && <TreePanel />}
            {sheet === "parts" && <PartsPanel />}
          </div>
        </div>
      )}
      <nav className="relative z-30 flex h-12 shrink-0 border-t border-gray-200 bg-white" data-testid="mobile-nav">
        {MOBILE_TABS.filter((t) => t.id !== "parts" || editor).map((t) => (
          <button
            key={t.id}
            className={`flex-1 text-xs font-bold ${panel === t.id ? "text-maroon" : "text-gray-600"}`}
            onClick={() => setMap({ mobilePanel: panel === t.id ? null : t.id })}
            data-testid={`mobile-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

export function App() {
  const desktop = useMedia("(min-width: 1024px)");
  const me = useMap((s) => s.me);
  const front = useMap((s) => s.frontViewOpen && !!selectedShelfId(s.selection));
  useBoot();
  useShortcuts();
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header title="Warehouse map" subtitle="Sun City Plumbing & Heating · warehouse side" back="../">
        <DemoBadge />
        {me && desktop && <RoleBadge role={me.role} />}
        {me && (
          <DemoControls
            role={me.role}
            compact={!desktop}
            onRoleChange={async (r) => {
              await loadMe();
              if (r === "viewer") setMap({ editMode: false, tool: null });
            }}
          />
        )}
      </Header>
      <TopBar compact={!desktop} />
      <div className="relative flex min-h-0 flex-1">
        {desktop && (
          <aside className="w-72 shrink-0 border-r border-gray-200 bg-white" data-testid="left-panel">
            <LeftPanel />
          </aside>
        )}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <Viewport showResults={desktop} />
          {!desktop && <MobileShell />}
          {desktop && front && (
            <div className="h-[52%] min-h-[280px] shrink-0 border-t-4 border-gold" data-testid="front-dock">
              <FrontView onClose={() => setMap({ frontViewOpen: false })} />
            </div>
          )}
        </main>
        {desktop && (
          <aside
            className="w-[340px] shrink-0 overflow-auto border-l border-gray-200 bg-white"
            data-testid="right-panel"
          >
            <PartCard />
            <Inspector />
          </aside>
        )}
      </div>
      <DialogHost />
      <ToastBridge />
    </div>
  );
}
