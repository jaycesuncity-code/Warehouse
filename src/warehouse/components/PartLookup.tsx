import { useEffect, useId, useRef, useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { Part } from '../../shared/contract';
import { Button, Spinner } from '../../shared/ui';
import { checkLabel } from '../scanner';
import { PartRow } from './PartRow';

interface Props {
  /** Open (or pick) a part from the results. */
  onPick: (part: Part) => void;
  /** Typed text that is exactly a part label ID. */
  onLabelText?: (text: string) => void;
  autoFocus?: boolean;
  /** Result rows act as buttons (pick mode) instead of links. */
  pickMode?: boolean;
  label?: string;
  placeholder?: string;
  /** Don't list anything until something is typed. */
  hint?: string;
}

/** Type a part ID, code or name; results list below. Enter opens an exact or only match. */
export function PartLookup({
  onPick,
  onLabelText,
  autoFocus,
  pickMode,
  label = 'Part code, ID or name',
  placeholder = 'Type a code or a name',
  hint,
}: Props) {
  const id = useId();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Part[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setItems(null);
      setLoading(false);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      api
        .searchParts({ q: text, limit: 20 })
        .then((r) => {
          if (mine !== seq.current) return;
          setItems(r.items);
          setError(null);
        })
        .catch((e: unknown) => {
          if (mine !== seq.current) return;
          setError(isApiError(e) ? e.message : 'Search failed.');
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(t);
  }, [q]);

  function submit() {
    const text = q.trim();
    if (!text) return;
    const label = checkLabel(text);
    if (label.ok && onLabelText) {
      onLabelText(label.partId);
      return;
    }
    const exact = items?.find((p) => p.part_code.toLowerCase() === text.toLowerCase());
    if (exact) onPick(exact);
    else if (items && items.length === 1) onPick(items[0]);
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="label-xs">
            {label}
          </label>
          <input
            id={id}
            data-testid="lookup-input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={autoFocus}
            value={q}
            placeholder={placeholder}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 min-h-touch w-full rounded-xl border-2 border-surface-line bg-white px-3 text-lg font-semibold focus:border-maroon"
          />
        </div>
        <Button type="submit" className="mt-[22px] shrink-0" data-testid="lookup-go">
          Look up
        </Button>
      </form>
      {error ? (
        <p role="alert" className="font-semibold text-red-800">
          {error}
        </p>
      ) : null}
      {loading && !items ? <Spinner label="Searching…" /> : null}
      {items && items.length === 0 && !loading ? (
        <p className="card text-center text-lg font-semibold" data-testid="no-results">
          No parts match “{q.trim()}”.
        </p>
      ) : null}
      {items && items.length ? (
        <ul className="grid gap-2" aria-label="Matching parts" data-testid="lookup-results">
          {items.map((p) => (
            <li key={p.part_id}>
              <PartRow part={p} onSelect={pickMode || onPick ? (x) => onPick(x) : undefined} />
            </li>
          ))}
        </ul>
      ) : null}
      {!q.trim() && hint ? <p className="text-center text-base text-ink-soft">{hint}</p> : null}
    </div>
  );
}
