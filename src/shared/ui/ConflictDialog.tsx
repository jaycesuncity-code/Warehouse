import { Button } from './Button';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  /** "Someone else just changed this count. It's now N." */
  message: string;
  canOverwrite: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}

/** Shown on a 409 version_conflict: Reload for everyone, Keep mine for admins only. */
export function ConflictDialog({ open, message, canOverwrite, onReload, onOverwrite, onClose }: Props) {
  return (
    <Modal open={open} title="Out of date" onClose={onClose} tone="warn" testId="conflict-dialog">
      <p className="text-lg font-semibold" data-testid="conflict-message">
        {message}
      </p>
      <div className="grid gap-2">
        <Button block onClick={onReload}>
          Reload
        </Button>
        {canOverwrite ? (
          <Button block variant="neutral" onClick={onOverwrite}>
            Keep mine
          </Button>
        ) : (
          <p className="text-sm text-ink-soft">Only an admin can overwrite someone else's change.</p>
        )}
        <Button block variant="neutral" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
