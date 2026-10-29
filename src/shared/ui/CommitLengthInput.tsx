import { useEffect, useId, useState } from "react";
import { formatFtIn, parseLength, sheetYToMapY, type LengthUnit } from "../../map/units";

/**
 * Length input: accepts 40'-3", 40-3, 483", 483 …; shows the parsed value; commits on blur or
 * Enter. `survey="y"` adds the "Enter from survey sheet" conversion (Y_map = 1947 - Y_sheet).
 */
export function CommitLengthInput({
  label,
  value,
  onCommit,
  unit = "in",
  disabled,
  survey,
  surveyOn,
  min,
  testId,
  status,
}: {
  label: string;
  value: number | null;
  onCommit: (inches: number) => void;
  unit?: LengthUnit;
  disabled?: boolean;
  survey?: "x" | "y";
  surveyOn?: boolean;
  min?: number;
  testId?: string;
  status?: "saving" | "saved" | "error" | null;
}) {
  const id = useId();
  const display = (v: number | null) => {
    if (v == null) return "";
    if (survey === "y" && surveyOn) return formatFtIn(sheetYToMapY(v));
    return formatFtIn(v);
  };
  const [text, setText] = useState(display(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(display(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, surveyOn, focused]);
  const parsed = parseLength(text, unit);
  const toMap = (p: number) => (survey === "y" && surveyOn ? sheetYToMapY(p) : p);
  const invalid = text.trim() !== "" && (parsed == null || (min != null && toMap(parsed) < min));
  const commit = () => {
    if (parsed == null || invalid) return;
    const v = toMap(parsed);
    if (value == null || Math.abs(v - value) > 1e-6) onCommit(v);
  };
  return (
    <div>
      <label htmlFor={id} className="field-label flex items-center gap-1">
        {label}
        {survey && surveyOn && <span className="text-amber-700 normal-case">(survey sheet)</span>}
        {status === "saving" && <span className="ml-auto text-gray-500 normal-case">Saving…</span>}
        {status === "saved" && <span className="ml-auto text-emerald-700 normal-case">Saved</span>}
        {status === "error" && <span className="ml-auto text-red-700 normal-case">Error</span>}
      </label>
      <input
        id={id}
        data-testid={testId}
        className={`field font-mono ${invalid ? "border-red-500 bg-red-50" : ""}`}
        value={text}
        disabled={disabled}
        inputMode="text"
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Blur commits once. (Committing here too sent the same edit twice; the second
            // carried a stale version and came back as a false "changed by someone else".)
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setText(display(value));
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
      />
      {focused && (
        <div className={`mt-0.5 text-[11px] ${invalid ? "text-red-700" : "text-gray-500"}`}>
          {parsed == null ? (text.trim() ? "Can't read that — try 40'-3\" or 483\"" : " ") : `= ${parsed}" (${formatFtIn(parsed)})${survey === "y" && surveyOn ? ` → map Y ${formatFtIn(toMap(parsed))}` : ""}`}
        </div>
      )}
    </div>
  );
}
