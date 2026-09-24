import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { DocumentId } from "@floe-note/domain";

import {
  splitSearchTerms,
  type GlobalSearchCache,
  type GlobalSearchResult,
} from "./global-search.js";
import { Modal } from "./Modal.js";

type GlobalSearchProps = {
  cache: GlobalSearchCache;
  lastOpenedAt: ReadonlyMap<DocumentId, number>;
  onClose: () => void;
  onSelect: (documentId: DocumentId) => void;
};

export function GlobalSearch({
  cache,
  lastOpenedAt,
  onClose,
  onSelect,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const terms = useMemo(() => splitSearchTerms(query), [query]);
  const results = cache.search(query, lastOpenedAt);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex((current) =>
      results.length === 0 ? 0 : Math.min(current, results.length - 1),
    );
  }, [query, results.length]);

  function select(result: GlobalSearchResult): void {
    onSelect(result.id);
    onClose();
  }

  return (
    <Modal labelledBy="global-search-title" onClose={onClose}>
      <div className="global-search">
        <h2 id="global-search-title" className="global-search-heading">
          Search notes
        </h2>

        <div className="global-search-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            value={query}
            aria-label="Search all notes"
            placeholder="Search notes"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  results.length === 0
                    ? 0
                    : Math.min(current + 1, results.length - 1),
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }

              if (event.key === "Enter") {
                const active = results[activeIndex];
                if (active) {
                  event.preventDefault();
                  select(active);
                }
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="global-search-section-label">
          {terms.length === 0 ? "Recent notes" : `${results.length} results`}
        </div>

        <div
          className="global-search-results"
          role="listbox"
          aria-label={terms.length === 0 ? "Recent notes" : "Search results"}
        >
          {results.length > 0 ? (
            results.map((result, index) => (
              <button
                key={result.id}
                className={
                  index === activeIndex
                    ? "global-search-result active"
                    : "global-search-result"
                }
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(result)}
              >
                <span className="global-search-result-title">
                  {highlightText(result.title, terms)}
                </span>
                {result.matchedTags.length > 0 ? (
                  <span
                    className="global-search-result-tags"
                    aria-label="Matching tags"
                  >
                    {result.matchedTags.slice(0, 3).map((tag) => (
                      <span className="global-search-result-tag" key={tag}>
                        <span aria-hidden="true">#</span>
                        {highlightText(tag, terms)}
                      </span>
                    ))}
                    {result.matchedTags.length > 3 ? (
                      <span className="global-search-result-tag-overflow">
                        +{result.matchedTags.length - 3}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {result.snippet ? (
                  <span className="global-search-result-snippet">
                    {highlightText(result.snippet, terms)}
                  </span>
                ) : null}
              </button>
            ))
          ) : (
            <p className="global-search-empty">No matching notes</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function highlightText(
  text: string,
  terms: readonly string[],
): ReactNode {
  if (terms.length === 0 || !text) return text;

  const lower = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];

  for (const term of terms) {
    if (!term) continue;

    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(term, from);
      if (index < 0) break;
      ranges.push({ start: index, end: index + term.length });
      from = index + Math.max(term.length, 1);
    }
  }

  if (ranges.length === 0) return text;

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  merged.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark key={`${range.start}:${range.end}:${index}`}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  );
}
