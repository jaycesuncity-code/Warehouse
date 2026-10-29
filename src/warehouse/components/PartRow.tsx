import type { Part } from '../../shared/contract';
import { DepartmentChip, StatusChip } from '../../shared/ui';
import { href, partPath } from '../router';
import { partStatus } from '../stock';

interface Props {
  part: Part;
  /** If given, the row is a button instead of a link. */
  onSelect?: (part: Part) => void;
}

/** One search result: name, code, status, where it lives. */
export function PartRow({ part, onSelect }: Props) {
  const codes = part.locations.map((l) => l.location_code);
  const body = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-lg font-extrabold leading-tight">{part.part_name}</span>
        <span className="mt-0.5 block truncate font-mono text-base font-bold text-maroon">
          {part.part_code}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <DepartmentChip dept={part.department} />
          <span className="text-base font-semibold text-ink-soft" data-testid="row-locations">
            {codes.length ? codes.join(' · ') : 'Not assigned yet'}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusChip status={partStatus(part)} />
        <span className="text-base font-bold">
          {part.on_hand_total} <span className="font-medium text-ink-soft">on hand</span>
        </span>
      </span>
    </>
  );
  const cls = 'card flex min-h-[88px] w-full items-center gap-3 text-ink hover:border-maroon';
  return onSelect ? (
    <button
      type="button"
      className={cls}
      data-testid="part-row"
      data-part-code={part.part_code}
      onClick={() => onSelect(part)}
    >
      {body}
    </button>
  ) : (
    <a
      className={cls}
      data-testid="part-row"
      data-part-code={part.part_code}
      href={href(partPath(part.part_id))}
    >
      {body}
    </a>
  );
}
