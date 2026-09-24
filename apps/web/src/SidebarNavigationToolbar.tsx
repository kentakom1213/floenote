import { useEffect, useRef } from "react";

import {
  type NoteSortDirection,
  type NoteSortMode,
  type NoteSortPreference,
  type TagFilterMode,
} from "./sidebar-navigation.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

type SidebarNavigationToolbarProps = {
  query: string;
  searchOpen: boolean;
  sort: NoteSortPreference;
  tags: readonly string[];
  selectedTags: readonly string[];
  tagFilterMode: TagFilterMode;
  onQueryChange: (query: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  onSortChange: (preference: NoteSortPreference) => void;
  onSelectedTagsChange: (tags: readonly string[]) => void;
  onTagFilterModeChange: (mode: TagFilterMode) => void;
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
  tags,
  selectedTags,
  tagFilterMode,
  onQueryChange,
  onSearchOpenChange,
  onSortChange,
  onSelectedTagsChange,
  onTagFilterModeChange,
  onCreateDocument,
}: SidebarNavigationToolbarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDetailsElement>(null);
  const tagMenuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(sortMenuRef);
  useDismissibleDetails(tagMenuRef);

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

  function toggleTag(tag: string): void {
    onSelectedTagsChange(
      selectedTags.includes(tag)
        ? selectedTags.filter((selected) => selected !== tag)
        : [...selectedTags, tag],
    );
  }

  const ascendingLabel = sort.mode === "title" ? "A–Z" : "Oldest first";
  const descendingLabel = sort.mode === "title" ? "Z–A" : "Newest first";
  const tagFilterActive = selectedTags.length > 0;

  return (
    <div className="sidebar-navigation">
      <div className="sidebar-toolbar" role="toolbar" aria-label="Note navigation">
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

        <details className="sidebar-tag-filter" ref={tagMenuRef}>
          <summary
            className={
              tagFilterActive
                ? "sidebar-tool-button active"
                : "sidebar-tool-button"
            }
            aria-label="Filter notes by tags"
            title="Filter notes by tags"
          >
            <TagFilterIcon />
          </summary>

          <div className="sidebar-tag-filter-menu" aria-label="Tag filter">
            <p className="sidebar-sort-label">Match selected tags</p>
            <div className="sidebar-tag-filter-mode" role="radiogroup" aria-label="Tag filter mode">
              <label>
                <input
                  type="radio"
                  name="sidebar-tag-filter-mode"
                  checked={tagFilterMode === "and"}
                  onChange={() => onTagFilterModeChange("and")}
                />
                <span>AND</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="sidebar-tag-filter-mode"
                  checked={tagFilterMode === "or"}
                  onChange={() => onTagFilterModeChange("or")}
                />
                <span>OR</span>
              </label>
            </div>

            <div className="sidebar-sort-divider" />
            <div className="sidebar-tag-filter-heading">
              <p className="sidebar-sort-label">Tags</p>
              {tagFilterActive ? (
                <button
                  type="button"
                  onClick={() => onSelectedTagsChange([])}
                >
                  Clear
                </button>
              ) : null}
            </div>

            {tags.length > 0 ? (
              <div className="sidebar-tag-filter-options">
                {tags.map((tag) => (
                  <label key={tag}>
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag)}
                      onChange={() => toggleTag(tag)}
                    />
                    <span className="sidebar-tag-filter-hash" aria-hidden="true">
                      #
                    </span>
                    <span>{tag}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="sidebar-tag-filter-empty">No tags yet</p>
            )}
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

function TagFilterIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 3.5h8v13l-4-2.6-4 2.6z" />
    </svg>
  );
}

function NewNoteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
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
