import { useId } from "react";

type SidebarTagNavigationProps = {
  tags: readonly string[];
  selectedTag: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelectTag: (tag: string | null) => void;
};

export function SidebarTagNavigation({
  tags,
  selectedTag,
  expanded,
  onExpandedChange,
  onSelectTag,
}: SidebarTagNavigationProps) {
  const listId = useId();

  return (
    <section className="sidebar-tag-section" aria-label="Tags">
      <button
        className="sidebar-section-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span
          className={
            expanded
              ? "sidebar-section-chevron expanded"
              : "sidebar-section-chevron"
          }
          aria-hidden="true"
        >
          <ChevronIcon />
        </span>
        <span>Tags</span>
      </button>

      {expanded ? (
        <div className="sidebar-tag-list" id={listId}>
          <button
            className={
              selectedTag === null
                ? "sidebar-tag-row selected"
                : "sidebar-tag-row"
            }
            type="button"
            aria-current={selectedTag === null ? "page" : undefined}
            onClick={() => onSelectTag(null)}
          >
            <span className="sidebar-tag-symbol" aria-hidden="true">
              #
            </span>
            <span className="sidebar-tag-name">All notes</span>
          </button>

          {tags.map((tag) => (
            <button
              className={
                selectedTag === tag
                  ? "sidebar-tag-row selected"
                  : "sidebar-tag-row"
              }
              type="button"
              aria-current={selectedTag === tag ? "page" : undefined}
              key={tag}
              onClick={() => onSelectTag(tag)}
            >
              <span className="sidebar-tag-symbol" aria-hidden="true">
                #
              </span>
              <span className="sidebar-tag-name">{tag}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7 5 5 5-5 5" />
    </svg>
  );
}
