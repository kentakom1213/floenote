import { useRef } from "react";

import { DEFAULT_TAG_COLOR, type TagColor } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { TagChip } from "./TagChip.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

export const SIDEBAR_TAG_LIMIT = 3;

type SidebarNoteRowProps = {
  id: DocumentId;
  title: string;
  tags?: readonly string[];
  getTagColor?: (tag: string) => TagColor;
  selected: boolean;
  onSelect: (documentId: DocumentId) => void;
  onDelete: (documentId: DocumentId) => void;
  onMove: (documentId: DocumentId) => void;
};

export function SidebarNoteRow({
  id,
  title,
  tags = [],
  getTagColor = () => DEFAULT_TAG_COLOR,
  selected,
  onSelect,
  onDelete,
  onMove,
}: SidebarNoteRowProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menuRef);

  const displayTitle = title || "Untitled";
  const visibleTags = tags.slice(0, SIDEBAR_TAG_LIMIT);
  const remainingTagCount = Math.max(0, tags.length - visibleTags.length);

  return (
    <div className={selected ? "note-row selected" : "note-row"}>
      <button
        className="note-item"
        type="button"
        onClick={() => onSelect(id)}
      >
        <span className="note-item-title">{displayTitle}</span>
        {visibleTags.length > 0 ? (
          <span className="note-item-tags" aria-label="Tags">
            {visibleTags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                color={getTagColor(tag)}
                compact
              />
            ))}
            {remainingTagCount > 0 ? (
              <span
                className="note-item-tag-overflow"
                aria-label={`${remainingTagCount} more tags`}
              >
                +{remainingTagCount}
              </span>
            ) : null}
          </span>
        ) : null}
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
            className="note-row-menu-item"
            type="button"
            onClick={() => {
              menuRef.current?.removeAttribute("open");
              onMove(id);
            }}
          >
            Move note…
          </button>
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
