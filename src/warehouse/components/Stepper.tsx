interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  /** Extra text under the number, e.g. the size in ft-in. */
  hint?: string;
  testId?: string;
  disabled?: boolean;
}

/** Big minus / plus around a number. 56 px touch targets. */
export function Stepper({ label, value, min = 0, max = 999, onChange, hint, testId, disabled }: Props) {
  const dec = () => onChange(Math.max(value - 1, min));
  const inc = () => onChange(Math.min(value + 1, max));
  return (
    <div className="flex items-center gap-2" data-testid={testId} role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label}: one less`}
        className="btn btn-neutral min-w-touch !px-0 text-3xl"
        disabled={disabled || value <= min}
        onClick={dec}
      >
        −
      </button>
      <div className="min-w-[84px] flex-1 text-center">
        <p
          className="text-3xl font-extrabold leading-none"
          data-testid={testId ? `${testId}-value` : undefined}
          aria-live="polite"
        >
          {value}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-ink-soft">{hint ?? label}</p>
      </div>
      <button
        type="button"
        aria-label={`${label}: one more`}
        className="btn btn-neutral min-w-touch !px-0 text-3xl"
        disabled={disabled || value >= max}
        onClick={inc}
      >
        +
      </button>
    </div>
  );
}
