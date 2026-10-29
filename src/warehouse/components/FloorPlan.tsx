import { useMemo } from 'react';
import type { Layout } from '../../shared/contract';
import { buildFloorPlan } from '../floorplan';

interface Props {
  layout: Layout;
  shelfId: string;
  slotId?: string | null;
  maxW?: number;
  maxH?: number;
}

const pts = (p: [number, number][]) => p.map((q) => q.join(',')).join(' ');

/** Light top-down plan: zone outlines, openings, shelves as rotated rectangles, pulsing dot on the chosen shelf. */
export function FloorPlan({ layout, shelfId, slotId, maxW = 340, maxH = 300 }: Props) {
  const m = useMemo(() => buildFloorPlan(layout, shelfId, slotId), [layout, shelfId, slotId]);
  const { x, y, w, h } = m.viewBox;
  // Label rooms whose centre is in view; the focused room first, and skip labels that would sit on top of each other.
  const labels = (() => {
    const placed: { zone_id: string; room_no: string | null; focus: boolean; cx: number; cy: number }[] = [];
    const area = (z: (typeof m.zones)[number]) => (z.bbox[2] - z.bbox[0]) * (z.bbox[3] - z.bbox[1]);
    for (const z of [...m.zones].sort((a, b) => Number(b.focus) - Number(a.focus) || area(b) - area(a))) {
      if (!z.room_no) continue;
      const cx = (z.bbox[0] + z.bbox[2]) / 2;
      const cy = (z.bbox[1] + z.bbox[3]) / 2;
      if (cx < x || cx > x + w || cy < y || cy > y + h) continue;
      if (placed.some((p) => Math.abs(p.cx - cx) < 160 && Math.abs(p.cy - cy) < 50)) continue;
      placed.push({ zone_id: z.zone_id, room_no: z.room_no, focus: z.focus, cx, cy });
    }
    return placed;
  })();
  const scale = Math.min(maxW / w, maxH / h);
  const u = (px: number) => px / scale; // px -> map inches

  return (
    <svg
      role="img"
      aria-label={`Floor plan of ${m.focusZoneName ?? 'the warehouse'} with the shelf marked`}
      data-testid="floor-plan"
      data-focus-zone={m.focusZoneName ?? ''}
      viewBox={`${x} ${y} ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      style={{ display: 'block', maxWidth: '100%', background: '#FAFAFA' }}
    >
      {m.zones.map((z) => (
        <g key={z.zone_id}>
          <polygon
            data-zone={z.name}
            data-bbox={z.bbox.join(',')}
            data-width-in={z.bbox[2] - z.bbox[0]}
            data-height-in={z.bbox[3] - z.bbox[1]}
            points={pts(z.points)}
            fill={z.focus ? '#FFFFFF' : '#EFEFEF'}
            stroke="none"
          />
          {z.points.map((p, i) => {
            const q = z.points[(i + 1) % z.points.length];
            const open = z.open_edges.includes(i);
            return (
              <line
                key={i}
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                stroke={open ? '#A3A3A3' : '#262626'}
                strokeWidth={u(open ? 1.5 : 3)}
                strokeDasharray={open ? `${u(5)} ${u(4)}` : undefined}
              />
            );
          })}
        </g>
      ))}
      {m.openings.map((o) => (
        <line
          key={o.opening_id}
          x1={o.a[0]}
          y1={o.a[1]}
          x2={o.b[0]}
          y2={o.b[1]}
          stroke={o.kind === 'overhead' ? '#C9A84C' : '#FFFFFF'}
          strokeWidth={u(o.kind === 'overhead' ? 5 : 4)}
          data-opening={o.kind}
        />
      ))}
      {m.shelves.map((s) => (
        <g key={s.shelf_id}>
          <polygon
            data-shelf={s.name}
            data-focus={s.focus ? 'true' : 'false'}
            data-points={s.points.map((p) => p.join(',')).join(' ')}
            points={pts(s.points)}
            fill={s.focus ? '#6B1A2C' : '#C8C8C8'}
            stroke={s.focus ? '#4E1220' : '#8A8A8A'}
            strokeWidth={u(1.5)}
          />
          <line
            data-front={s.name}
            x1={s.front[0][0]}
            y1={s.front[0][1]}
            x2={s.front[1][0]}
            y2={s.front[1][1]}
            stroke={s.focus ? '#C9A84C' : '#6B6B6B'}
            strokeWidth={u(s.focus ? 3.5 : 2)}
          />
        </g>
      ))}
      {labels.map((z) => (
        <text
          key={z.zone_id}
          x={z.cx}
          y={z.cy}
          fontSize={u(z.focus ? 12 : 9)}
          fontWeight={z.focus ? 800 : 600}
          textAnchor="middle"
          fill={z.focus ? '#262626' : '#737373'}
          pointerEvents="none"
        >
          {`Room ${z.room_no}`}
        </text>
      ))}
      {m.marker ? (
        <g data-testid="plan-marker" data-x={m.marker[0]} data-y={m.marker[1]}>
          <circle
            className="pulse-dot"
            cx={m.marker[0]}
            cy={m.marker[1]}
            r={u(9)}
            fill="#6B1A2C"
            opacity={0.5}
          />
          <circle
            cx={m.marker[0]}
            cy={m.marker[1]}
            r={u(6)}
            fill="#6B1A2C"
            stroke="#FFFFFF"
            strokeWidth={u(2)}
          />
        </g>
      ) : null}
    </svg>
  );
}
