import { createRoot } from "react-dom/client";
import "../shared/ui/base.css";
import { MODE } from "../shared/config";
import { ToastProvider } from "../shared/ui";
import { App } from "./App";

async function boot() {
  const params = new URLSearchParams(window.location.search);
  // ?perf=1 (mock mode only): 300 shelves / ~5,000 slots for performance checks. Not saved.
  if (MODE === "mock" && params.get("perf")) {
    const mock = await import("../shared/mock");
    mock.seedPerfData(Number(params.get("shelves")) || 300, Number(params.get("slots")) || 5000);
  }
  if (MODE === "mock" && params.get("latency")) {
    const mock = await import("../shared/mock");
    mock.setMockLatency(Number(params.get("latency")));
  }
  createRoot(document.getElementById("root")!).render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

void boot();
