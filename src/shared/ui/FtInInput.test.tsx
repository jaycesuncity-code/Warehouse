// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { FtInInput } from "./FtInInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("FtInInput", () => {
  it("commits once when Enter is pressed (Enter blurs; blur commits)", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onCommit = vi.fn();
    const root = createRoot(el);
    await act(async () => root.render(<FtInInput label="Width" value={96} onCommit={onCommit} testId="w" />));
    const input = el.querySelector("input")!;
    await act(async () => input.focus());
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "8'-6\"");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(102);
    await act(async () => root.unmount());
  });
});
