import { useEffect, useId, useState } from 'react';
import { formatFtIn, formatInches, parseLengthDetailed, type LengthUnit } from '../units';

interface Props {
  label: string;
  /** Inches, or null for empty. */
  value: number | null;
  onChange: (inches: number | null) => void;
  /** What a bare number means (feet field vs inch field). */
  defaultUnit?: LengthUnit;
  optional?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

/** Type 40'-3", 40 3, 483 ... and see the parsed value next to the box. Stores inches. */
export function FtInInput({
  label,
  value,
  onChange,
  defaultUnit = 'in',
  optional,
  placeholder,
  disabled,
}: Props) {
  const id = useId();
  const [text, setText] = useState(value == null ? '' : formatFtIn(value));
  const [lastSent, setLastSent] = useState<number | null>(value);

  useEffect(() => {
    if (value !== lastSent) {
      setText(value == null ? '' : formatFtIn(value));
      setLastSent(value);
    }
  }, [value, lastSent]);

  const parsed = text.trim() === '' ? null : parseLengthDetailed(text, defaultUnit);
  const error = parsed && !parsed.ok ? parsed.error : null;

  return (
    <div>
      <label htmlFor={id} className="label-xs">
        {label}
        {optional ? ' (optional)' : ''}
      </label>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={`${id}-hint`}
        placeholder={placeholder ?? (defaultUnit === 'ft' ? `e.g. 7'-8" or 7.5` : `e.g. 15 or 1'-3"`)}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === '') {
            setLastSent(null);
            onChange(null);
            return;
          }
          const r = parseLengthDetailed(t, defaultUnit);
          if (r.ok) {
            setLastSent(r.inches);
            onChange(r.inches);
          }
        }}
        className="mt-1 min-h-touch w-full rounded-xl border-2 border-surface-line bg-white px-3 text-lg font-semibold aria-[invalid=true]:border-red-600"
      />
      <p
        id={`${id}-hint`}
        className={`mt-1 min-h-[1.25rem] text-sm ${error ? 'font-semibold text-red-700' : 'text-ink-soft'}`}
      >
        {error ??
          (parsed && parsed.ok ? `= ${formatFtIn(parsed.inches)} (${formatInches(parsed.inches)})` : '')}
      </p>
    </div>
  );
}
