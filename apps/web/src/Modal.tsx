import { useEffect, useRef, type ReactNode } from "react";

type ModalProps = {
  labelledBy: string;
  onClose: () => void;
  disabled?: boolean;
  shouldRestoreFocus?: () => boolean;
  children: ReactNode;
};

export function Modal({
  labelledBy,
  onClose,
  disabled = false,
  shouldRestoreFocus = () => true,
  children,
}: ModalProps) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const shouldRestoreFocusRef = useRef(shouldRestoreFocus);
  shouldRestoreFocusRef.current = shouldRestoreFocus;

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      if (
        shouldRestoreFocusRef.current() &&
        previouslyFocused?.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disabled) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !disabled) onClose();
      }}
    >
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </section>
    </div>
  );
}
