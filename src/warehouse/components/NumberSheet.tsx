import { useState } from 'react';
import { Button, Modal } from '../../shared/ui';

interface Props {
  open: boolean;
  title: string;
  help?: string;
  initial: number;
  confirmLabel: string;
  onConfirm: (n: number) => void;
  onClose: () => void;
  testId?: string;
}

/** The form lives inside the modal, so its text starts fresh at `initial` every time the sheet opens. */
function SheetForm({
  help,
  initial,
  confirmLabel,
  onConfirm,
  onClose,
}: Omit<Props, 'open' | 'title' | 'testId'>) {
  const [text, setText] = useState(String(initial));
  const n = text.trim() === '' ? NaN : Number(text);
  const valid = Number.isInteger(n) && n >= 0 && n <= 1_000_000;
  return (
    <>
      {help ? <p className="text-base text-ink-soft">{help}</p> : null}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(n);
        }}
      >
        <label className="label-xs" htmlFor="number-sheet-input">
          Number
        </label>
        <input
          id="number-sheet-input"
          data-testid="number-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.target.select()}
          className="min-h-[72px] w-full rounded-2xl border-2 border-maroon bg-white px-4 text-center text-5xl font-extrabold"
        />
        <Button type="submit" disabled={!valid} data-testid="number-confirm">
          {confirmLabel}
        </Button>
        <Button variant="neutral" onClick={onClose}>
          Cancel
        </Button>
      </form>
    </>
  );
}

/** Type an exact whole number on the numeric keypad. Never below 0. */
export function NumberSheet({ open, title, onClose, testId, ...rest }: Props) {
  return (
    <Modal open={open} title={title} onClose={onClose} testId={testId}>
      <SheetForm {...rest} onClose={onClose} />
    </Modal>
  );
}
