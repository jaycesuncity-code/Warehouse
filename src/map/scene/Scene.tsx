import { Canvas } from "@react-three/fiber";
import { useMap } from "../store";
import { Building } from "./Building";
import { CameraRig } from "./CameraRig";
import { EquipmentMarkers } from "./EquipmentMarkers";
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
      <EquipmentMarkers />
      <FloorEvents />
      <AdminHandles />
      <WalkController />
      <LabelProjector />
      <SceneDebug />
      <DropPicker />
    </Canvas>
  );
}
