import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import type { DocumentId } from "@floe-note/domain";

type SidebarTrashNoteRowProps = {
  id: DocumentId;
  title: string;
  selected: boolean;
  onSelect: (documentId: DocumentId) => void;
  onRestore: (documentId: DocumentId) => void;
  onRequestPermanentDelete: (documentId: DocumentId) => void;
};

type MenuPosition = {
  top: number;
  left: number;
};

const MENU_GAP = 5;
const VIEWPORT_MARGIN = 8;

export function SidebarTrashNoteRow({
  id,
  title,
  selected,
  onSelect,
  onRestore,
  onRequestPermanentDelete,
}: SidebarTrashNoteRowProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const displayTitle = title || "Untitled";

  useLayoutEffect(() => {
    if (!menuOpen) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();

      const left = Math.min(
        Math.max(
          VIEWPORT_MARGIN,
          triggerRect.right - menuRect.width,
        ),
        window.innerWidth - menuRect.width - VIEWPORT_MARGIN,
      );

      const below = triggerRect.bottom + MENU_GAP;
      const above = triggerRect.top - menuRect.height - MENU_GAP;
      const top =
        below + menuRect.height <= window.innerHeight - VIEWPORT_MARGIN
          ? below
          : Math.max(VIEWPORT_MARGIN, above);

      setMenuPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }

      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function closeMenu(): void {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        top: menuPosition.top,
        left: menuPosition.left,
      }
    : undefined;

  return (
    <div
      className={
        selected
          ? "note-row sidebar-trash-note-row selected"
          : "note-row sidebar-trash-note-row"
      }
    >
      <button
        className="note-item sidebar-trash-note-item"
        type="button"
        onClick={() => onSelect(id)}
      >
        {displayTitle}
      </button>

      <button
        ref={triggerRef}
        className="note-row-menu-trigger"
        type="button"
        aria-label={`Actions for ${displayTitle}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Deleted note actions"
        onClick={() => {
          setMenuPosition(null);
          setMenuOpen((open) => !open);
        }}
      >
        <EllipsisIcon />
      </button>

      {menuOpen
        ? createPortal(
            <div
              ref={menuRef}
              className="note-row-menu-popover sidebar-trash-floating-menu"
              role="menu"
              style={menuStyle}
            >
              <button
                className="note-row-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onRestore(id);
                }}
              >
                Restore
              </button>
              <button
                className="note-row-menu-item danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onRequestPermanentDelete(id);
                }}
              >
                Delete permanently
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="10" r="1.15" />
      <circle cx="10" cy="10" r="1.15" />
      <circle cx="15" cy="10" r="1.15" />
    </svg>
  );
}
