import { Component, type ReactNode } from "react";

/** Probe before starting Three.js: canvas fallback content does not handle a failed WebGL context. */
function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
    if (!context) return false;
    // The renderer owns its own canvas. Release this small probe immediately.
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Isolates graphics initialization/render errors from search, shelf fronts, and the rest of the app. */
export class GraphicsBoundary extends Component<{ children: ReactNode }, { unavailable: boolean }> {
  state = { unavailable: !hasWebGL2() };

  static getDerivedStateFromError() {
    return { unavailable: true };
  }

  render() {
    if (!this.state.unavailable) return this.props.children;
    return (
      <section className="h-full overflow-auto bg-surface p-4" data-testid="map-graphics-unavailable" aria-labelledby="graphics-unavailable-title">
        <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-sm" role="alert">
          <h2 id="graphics-unavailable-title" className="text-lg font-bold text-maroon">3D map unavailable</h2>
          <p className="mt-2 text-sm text-gray-700">This browser could not start the map graphics. Enable hardware acceleration in your browser settings, close other 3D tabs, or try another browser.</p>
          <p className="mt-2 text-sm text-gray-700">You can still search for parts above, open shelf front views, and use inventory and scanning.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => this.setState({ unavailable: !hasWebGL2() })}>Retry 3D map</button>
            <a className="btn-ghost" href="/warehouse/">Open warehouse scanner</a>
          </div>
        </div>
      </section>
    );
  }
}
