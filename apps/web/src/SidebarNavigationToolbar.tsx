import { useEffect, useRef } from "react";

import {
  type NoteSortDirection,
  type NoteSortMode,
  type NoteSortPreference,
} from "./sidebar-navigation.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

type SidebarNavigationToolbarProps = {
  query: string;
  searchOpen: boolean;
  sort: NoteSortPreference;
  onQueryChange: (query: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  onSortChange: (preference: NoteSortPreference) => void;
  onCreateDocument: () => void;
};

const SORT_MODES = [
  { mode: "updated", label: "Updated" },
  { mode: "created", label: "Created" },
  { mode: "title", label: "Title" },
] satisfies readonly { mode: NoteSortMode; label: string }[];

export function SidebarNavigationToolbar({
  query,
  searchOpen,
  sort,
  onQueryChange,
  onSearchOpenChange,
  onSortChange,
  onCreateDocument,
}: SidebarNavigationToolbarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(sortMenuRef);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function closeSearch(): void {
    onQueryChange("");
    onSearchOpenChange(false);
  }

  function setSortMode(mode: NoteSortMode): void {
    const direction: NoteSortDirection =
      mode === sort.mode
        ? sort.direction
        : mode === "title"
          ? "asc"
          : "desc";
    onSortChange({ mode, direction });
    sortMenuRef.current?.removeAttribute("open");
  }

  function setSortDirection(direction: NoteSortDirection): void {
    onSortChange({ ...sort, direction });
    sortMenuRef.current?.removeAttribute("open");
  }

  const ascendingLabel = sort.mode === "title" ? "A–Z" : "Oldest first";
  const descendingLabel = sort.mode === "title" ? "Z–A" : "Newest first";

  return (
    <div className="sidebar-navigation">
      <div className="sidebar-toolbar" aria-label="Note navigation">
        <button
          className={searchOpen ? "sidebar-tool-button active" : "sidebar-tool-button"}
          type="button"
          aria-label="Search notes"
          aria-pressed={searchOpen}
          title="Search notes"
          onClick={() => {
            if (searchOpen) {
              closeSearch();
            } else {
              onSearchOpenChange(true);
            }
          }}
        >
          <SearchIcon />
        </button>

        <details className="sidebar-sort" ref={sortMenuRef}>
          <summary
            className="sidebar-tool-button"
            aria-label="Sort notes"
            title="Sort notes"
          >
            <SortIcon />
          </summary>
          <div className="sidebar-sort-menu">
            <p className="sidebar-sort-label">Sort by</p>
            <div className="sidebar-sort-options">
              {SORT_MODES.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  aria-pressed={sort.mode === option.mode}
                  onClick={() => setSortMode(option.mode)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="sidebar-sort-divider" />
            <p className="sidebar-sort-label">Order</p>
            <div className="sidebar-sort-options">
              <button
                type="button"
                aria-pressed={sort.direction === "desc"}
                onClick={() => setSortDirection("desc")}
              >
                {descendingLabel}
              </button>
              <button
                type="button"
                aria-pressed={sort.direction === "asc"}
                onClick={() => setSortDirection("asc")}
              >
                {ascendingLabel}
              </button>
            </div>
          </div>
        </details>

        <button
          className="sidebar-tool-button"
          type="button"
          aria-label="New note"
          title="New note"
          onClick={onCreateDocument}
        >
          <NewNoteIcon />
        </button>
      </div>

      {searchOpen ? (
        <div className="sidebar-search">
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            aria-label="Filter notes by title or tag"
            placeholder="Filter notes"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeSearch();
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear note filter"
              title="Clear note filter"
              onClick={() => onQueryChange("")}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 3v14M3.5 5.5 6 3l2.5 2.5M14 17V3M11.5 14.5 14 17l2.5-2.5" />
    </svg>
  );
}

function NewNoteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="11" height="14" rx="2" />
      <path d="M14 7h3M15.5 5.5v3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m6 6 8 8M14 6l-8 8" />
    </svg>
  );
}
