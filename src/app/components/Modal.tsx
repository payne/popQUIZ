import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface ModalProps {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  actions?: ComponentChildren;
}

/** An in-page dialog (never window.alert/confirm). Escape or backdrop click closes it. */
export function Modal({ title, children, onClose, actions }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      class="modal"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div class="modal-body">
        <h2 id="modal-title">{title}</h2>
        {children}
        {actions && <div class="modal-actions">{actions}</div>}
      </div>
    </dialog>
  );
}

interface ConfirmProps {
  title: string;
  children: ComponentChildren;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ title, children, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button type="button" class="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" class={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
