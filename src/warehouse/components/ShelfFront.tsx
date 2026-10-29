/**
 * Front view of one shelf, drawn to scale from its real dimensions (inches). Rows count up from G at the
 * bottom, slots sit at their true spans, bins are drawn at their real size inside them.
 *  - fit:      scales to the container width (mini view).
 *  - pxPerIn:  fixed scale with sideways scroll (tap view, so small slots stay big enough to hit).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Shelf, Slot } from '../../shared/contract';
import type { GridRect } from '../../shared/grid';
import { formatFtIn, slotRect, cellWidth } from '../../shared/units';

export interface GhostRect {
  rect: GridRect;
  ok: boolean;
}

interface Props {
  shelf: Shelf;
  /** Drawn in maroon. */
  highlightSlotIds?: string[];
  /** Drawn with a gold outline (chosen target). */
  selectedSlotId?: string | null;
  /** When set, slots become buttons (only where `selectable` allows). */
  onSlotClick?: (slot: Slot) => void;
  selectable?: (slot: Slot) => boolean;
  /** Dashed preview of a new footprint (resize). */
  ghost?: GhostRect | null;
  /** Fixed scale; otherwise fit to width. */
  pxPerIn?: number;
  /** Hide part names (mini view). */
  compact?: boolean;
  /** Dim slots the user can't pick. */
  dimUnselectable?: boolean;
  className?: string;
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  if (maxChars < 3) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const out = lines.slice(0, maxLines);
  if (lines.length > maxLines)
    out[maxLines - 1] = out[maxLines - 1].slice(0, Math.max(maxChars - 1, 1)) + '…';
  return out.map((l) => (l.length > maxChars ? l.slice(0, Math.max(maxChars - 1, 1)) + '…' : l));
}

export function ShelfFront({
  shelf,
  highlightSlotIds = [],
  selectedSlotId = null,
  onSlotClick,
  selectable,
  ghost,
  pxPerIn,
  compact,
  dimUnselectable,
  className = '',
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(340);
  useEffect(() => {
    if (!box.current || pxPerIn) return;
    const el = box.current;
    const measure = () => setBoxW(Math.max(el.clientWidth, 120));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pxPerIn]);

  const W = shelf.width_in;
  const H = shelf.height_in;
  const MARGIN_L = 14; // inches reserved for row labels
  const ppi = pxPerIn ?? Math.max((boxW - 4) / (W + MARGIN_L + 4), 1.5);
  const fs = (px: number) => px / ppi; // font size in inches for a wanted pixel size
  const cw = cellWidth(shelf);
  const sy = (bottom: number, height: number) => H - bottom - height;

  const slotNodes = useMemo(
    () =>
      shelf.slots.map((slot) => {
        const r = slotRect(shelf, slot);
        return { slot, r };
      }),
    [shelf],
  );

  const interactive = !!onSlotClick;

  return (
    <div
      ref={box}
      className={`${pxPerIn ? 'overflow-x-auto' : ''} ${className}`}
      data-testid="shelf-front"
      data-shelf={shelf.name}
    >
      <svg
        role="img"
        aria-label={`Front of shelf ${shelf.name}, ${formatFtIn(W)} wide, ${formatFtIn(H)} tall`}
        viewBox={`${-MARGIN_L} -4 ${W + MARGIN_L + 4} ${H + 8}`}
        width={(W + MARGIN_L + 4) * ppi}
        height={(H + 8) * ppi}
        style={{ display: 'block', maxWidth: pxPerIn ? 'none' : '100%' }}
      >
        {/* frame + floor */}
        <rect x={0} y={0} width={W} height={H} fill="#F7F7F7" stroke="#8A8A8A" strokeWidth={fs(1.5)} />
        <rect x={-1} y={H} width={W + 2} height={2} fill="#525252" />
        <rect x={0} y={0} width={2} height={H} fill="#6B6B6B" />
        <rect x={W - 2} y={0} width={2} height={H} fill="#6B6B6B" />

        {/* decks + row labels */}
        {shelf.rows.map((row) => (
          <g key={row.row_index}>
            <rect x={0} y={sy(row.elevation_in, 0)} width={W} height={Math.max(1, fs(3))} fill="#525252" />
            <text
              x={-MARGIN_L / 2}
              y={sy(row.elevation_in, 0) - row.clear_height_in / 2}
              fontSize={fs(13)}
              fontWeight={800}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#262626"
            >
              {row.row_label}
            </text>
          </g>
        ))}

        {/* slots */}
        {slotNodes.map(({ slot, r }) => {
          const hi = highlightSlotIds.includes(slot.slot_id);
          const sel = selectedSlotId === slot.slot_id;
          const occupied = slot.parts.length > 0;
          const can = interactive && (selectable ? selectable(slot) : true);
          const dim = interactive && dimUnselectable && !can;
          const x = r.left;
          const y = sy(r.bottom, r.height);
          const pxW = r.width * ppi;
          const fontPx = 11;
          const maxChars = Math.floor((pxW - 8) / (fontPx * 0.56));
          const lines = compact
            ? []
            : occupied
              ? slot.parts.length > 1
                ? [`${slot.parts.length} parts`, ...slot.parts.slice(0, 2).map((p) => p.part_code)]
                : wrap(
                    slot.parts[0].part_name,
                    maxChars,
                    Math.max(Math.floor((r.height * ppi - 22) / (fontPx + 2)), 1),
                  )
              : [];
          const fill = hi ? '#6B1A2C' : occupied ? '#FFFFFF' : '#EDEDED';
          const textFill = hi ? '#FFFFFF' : '#262626';
          const label = `${slot.location_code}: ${occupied ? slot.parts.map((p) => p.part_name).join(' and ') : 'free'}`;
          const bin =
            slot.bin_width_in && slot.bin_height_in ? { w: slot.bin_width_in, h: slot.bin_height_in } : null;
          const clipId = `clip-${slot.slot_id}`;
          const content = (
            <>
              <title>{label}</title>
              <clipPath id={clipId}>
                <rect x={x} y={y} width={r.width} height={r.height} />
              </clipPath>
              <rect
                x={x + 0.4}
                y={y + 0.4}
                width={r.width - 0.8}
                height={r.height - 0.8}
                rx={1}
                fill={fill}
                stroke={sel ? '#C9A84C' : hi ? '#4E1220' : occupied ? '#737373' : '#A3A3A3'}
                strokeWidth={fs(sel ? 3.5 : hi ? 2 : 1.5)}
                strokeDasharray={occupied || sel ? undefined : `${fs(4)} ${fs(3)}`}
                opacity={dim ? 0.45 : 1}
              />
              {bin ? (
                <rect
                  x={x + (r.width - bin.w) / 2}
                  y={y + r.height - bin.h}
                  width={bin.w}
                  height={bin.h}
                  fill="none"
                  stroke={
                    bin.w > r.width + 0.01 || bin.h > r.height + 0.01 ? '#DC2626' : hi ? '#C9A84C' : '#B08D2E'
                  }
                  strokeWidth={fs(1.5)}
                  strokeDasharray={`${fs(5)} ${fs(3)}`}
                  data-bin="true"
                />
              ) : null}
              <g clipPath={`url(#${clipId})`} opacity={dim ? 0.55 : 1}>
                <text
                  x={x + fs(5)}
                  y={y + fs(13)}
                  fontSize={fs(10)}
                  fontWeight={800}
                  fill={hi ? '#E8D9A8' : '#6B1A2C'}
                >
                  {slot.slot_no}
                </text>
                {lines.map((l, i) => (
                  <text
                    key={i}
                    x={x + fs(5)}
                    y={y + fs(13) + fs(15) + i * fs(fontPx + 2)}
                    fontSize={fs(fontPx)}
                    fontWeight={i === 0 && slot.parts.length > 1 ? 800 : 600}
                    fill={textFill}
                  >
                    {l}
                  </text>
                ))}
              </g>
            </>
          );
          return can ? (
            <g
              key={slot.slot_id}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={sel}
              data-testid="front-slot"
              data-slot-id={slot.slot_id}
              data-slot-code={slot.location_code}
              data-occupied={occupied ? 'true' : 'false'}
              style={{ cursor: 'pointer' }}
              onClick={() => onSlotClick?.(slot)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSlotClick?.(slot);
                }
              }}
            >
              {content}
            </g>
          ) : (
            <g
              key={slot.slot_id}
              data-testid="front-slot"
              data-slot-id={slot.slot_id}
              data-slot-code={slot.location_code}
              data-occupied={occupied ? 'true' : 'false'}
              data-highlight={hi ? 'true' : undefined}
            >
              {content}
            </g>
          );
        })}

        {/* preview of a new footprint */}
        {ghost
          ? (() => {
              const g = slotRect(shelf, ghost.rect);
              return (
                <rect
                  data-testid="ghost"
                  data-ok={ghost.ok ? 'true' : 'false'}
                  x={g.left}
                  y={sy(g.bottom, g.height)}
                  width={g.width}
                  height={g.height}
                  fill={ghost.ok ? 'rgba(201,168,76,0.30)' : 'rgba(220,38,38,0.25)'}
                  stroke={ghost.ok ? '#9C7F2B' : '#B91C1C'}
                  strokeWidth={fs(2.5)}
                  strokeDasharray={`${fs(6)} ${fs(4)}`}
                  pointerEvents="none"
                />
              );
            })()
          : null}

        {/* column ticks along the bottom edge for orientation */}
        {pxPerIn
          ? Array.from({ length: shelf.cols }, (_, i) => (
              <text
                key={i}
                x={i * cw + cw / 2}
                y={H + 3.2}
                fontSize={fs(9)}
                textAnchor="middle"
                fill="#737373"
              >
                {i + 1}
              </text>
            ))
          : null}
      </svg>
    </div>
  );
}
