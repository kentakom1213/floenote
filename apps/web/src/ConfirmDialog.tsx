import { useState, type ReactNode } from "react";

import { Modal } from "./Modal.js";

type ConfirmDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmationPhrase?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmationPhrase,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canConfirm =
    !confirmationPhrase || confirmation === confirmationPhrase;

  async function confirm(): Promise<void> {
    if (busy || !canConfirm) return;

    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "The operation failed",
      );
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="confirmation-title" onClose={onClose} disabled={busy}>
      <h2 id="confirmation-title">{title}</h2>
      <div className="dialog-description">{description}</div>

      {confirmationPhrase ? (
        <label className="dialog-field">
          <span>
            Type <strong>{confirmationPhrase}</strong> to confirm
          </span>
          <input
            autoFocus
            value={confirmation}
            disabled={busy}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      ) : null}

      {error ? <p className="dialog-error">{error}</p> : null}

      <div className="dialog-actions">
        <button
          className="dialog-secondary-button"
          type="button"
          autoFocus={!confirmationPhrase}
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="dialog-danger-button"
          type="button"
          disabled={busy || !canConfirm}
          onClick={() => void confirm()}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
