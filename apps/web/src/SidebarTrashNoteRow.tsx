import { useRef } from "react";

import type { DocumentId } from "@floe-note/domain";

import { useDismissibleDetails } from "./useDismissibleDetails.js";

type SidebarTrashNoteRowProps = {
  id: DocumentId;
  title: string;
  selected: boolean;
  onSelect: (documentId: DocumentId) => void;
  onRestore: (documentId: DocumentId) => void;
  onRequestPermanentDelete: (documentId: DocumentId) => void;
};

export function SidebarTrashNoteRow({
  id,
  title,
  selected,
  onSelect,
  onRestore,
  onRequestPermanentDelete,
}: SidebarTrashNoteRowProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menuRef);

  const displayTitle = title || "Untitled";

  function closeMenu(): void {
    menuRef.current?.removeAttribute("open");
  }

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

      <details className="note-row-menu" ref={menuRef}>
        <summary
          className="note-row-menu-trigger"
          aria-label={`Actions for ${displayTitle}`}
          title="Deleted note actions"
        >
          <EllipsisIcon />
        </summary>
        <div className="note-row-menu-popover">
          <button
            className="note-row-menu-item"
            type="button"
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
            onClick={() => {
              closeMenu();
              onRequestPermanentDelete(id);
            }}
          >
            Delete permanently
          </button>
        </div>
      </details>
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
