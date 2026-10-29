import { Canvas } from "@react-three/fiber";
import { useMap } from "../store";
import { Building } from "./Building";
import { CameraRig } from "./CameraRig";
import { SceneDebug } from "./Debug";
import { DropPicker } from "./DropPicker";
import { AdminHandles, FloorEvents } from "./Floor";
import { LabelProjector } from "./labels";
import { PlanGrid, SearchGlow, SelectionOverlay } from "./Overlays3D";
import { Shelves } from "./Shelves";
import { WalkController } from "./Walk";

export function MapCanvas() {
  // Render continuously only while something animates by itself (walking, pulsing search dots);
  // otherwise redraw on demand (camera moves, edits) so an idle map costs nothing.
  const continuous = useMap((s) => s.view === "walk" || (!s.reducedMotion && s.search.focus.shelfIds.length > 0));
  return (
    <Canvas
      fallback={<div className="p-6 text-sm"><p className="font-bold">This browser cannot display the 3D map.</p><p className="mt-2">Enable hardware acceleration or use another browser. You can still search and scan parts.</p><a href="/warehouse/" className="mt-3 inline-block font-bold text-maroon underline">Open warehouse scanner →</a></div>}
      frameloop={continuous ? "always" : "demand"}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ touchAction: "none" }}
      data-testid="map-canvas"
      onCreated={({ gl }) => gl.setClearColor("#E6E9ED")}
    >
      <ambientLight intensity={0.85} />
      <hemisphereLight args={["#ffffff", "#9aa5b1", 0.55]} />
      <directionalLight position={[900, 2600, 1500]} intensity={1.15} />
      <directionalLight position={[-600, 1200, -400]} intensity={0.35} />
      <CameraRig />
      <Building />
      <PlanGrid />
      <Shelves />
      <SelectionOverlay />
      <SearchGlow />
      <FloorEvents />
      <AdminHandles />
      <WalkController />
      <LabelProjector />
      <SceneDebug />
      <DropPicker />
    </Canvas>
  );
}
