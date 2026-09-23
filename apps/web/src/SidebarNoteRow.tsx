import { useRef } from "react";

import type { DocumentId } from "@floe-note/domain";

import { useDismissibleDetails } from "./useDismissibleDetails.js";

type SidebarNoteRowProps = {
  id: DocumentId;
  title: string;
  selected: boolean;
  onSelect: (documentId: DocumentId) => void;
  onDelete: (documentId: DocumentId) => void;
};

export function SidebarNoteRow({
  id,
  title,
  selected,
  onSelect,
  onDelete,
}: SidebarNoteRowProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menuRef);

  const displayTitle = title || "Untitled";

  return (
    <div className={selected ? "note-row selected" : "note-row"}>
      <button
        className="note-item"
        type="button"
        onClick={() => onSelect(id)}
      >
        {displayTitle}
      </button>

      <details className="note-row-menu" ref={menuRef}>
        <summary
          className="note-row-menu-trigger"
          aria-label={`Actions for ${displayTitle}`}
          title="Note actions"
        >
          <EllipsisIcon />
        </summary>
        <div className="note-row-menu-popover">
          <button
            className="note-row-menu-item danger"
            type="button"
            onClick={() => {
              menuRef.current?.removeAttribute("open");
              onDelete(id);
            }}
          >
            Delete note
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
