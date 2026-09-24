import type { NoteDocument } from "@floe-note/document";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";

type NotePropertiesProps = {
  document: NoteDocument;
  availableTags?: readonly string[];
};

export type TagAssignmentOption = {
  kind: "existing" | "create";
  tag: string;
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NoteProperties({
  document,
  availableTags = [],
}: NotePropertiesProps) {
  const subscribe = useCallback(
    (listener: () => void) => document.subscribe(listener),
    [document],
  );
  const getSnapshot = useCallback(
    () => getNoteMetadataSnapshot(document),
    [document],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const addTagButtonRef = useRef<HTMLButtonElement>(null);
  const tagFormRef = useRef<HTMLFormElement>(null);
  const listboxId = useId();
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const tagOptions = getTagAssignmentOptions(
    availableTags,
    document.tags,
    tagInput,
  );
  const resolvedActiveOptionIndex =
    tagOptions.length === 0
      ? -1
      : Math.min(activeOptionIndex, tagOptions.length - 1);
  const activeOption =
    resolvedActiveOptionIndex < 0
      ? undefined
      : tagOptions[resolvedActiveOptionIndex];

  useEffect(() => {
    if (tagOptions.length > 0 && activeOptionIndex >= tagOptions.length) {
      setActiveOptionIndex(tagOptions.length - 1);
    }
  }, [activeOptionIndex, tagOptions.length]);

  function stopAddingTag(restoreFocus = false): void {
    setTagInput("");
    setActiveOptionIndex(0);
    setAddingTag(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => addTagButtonRef.current?.focus());
    }
  }

  function addTag(tag: string): void {
    const result = addTagFromInput(document, tag);
    if (result !== "empty") {
      stopAddingTag(true);
    }
  }

  function submitTag(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (activeOption) {
      addTag(activeOption.tag);
      return;
    }

    const result = addTagFromInput(document, tagInput);
    if (result !== "empty") {
      stopAddingTag(true);
    }
  }

  function handleTagInputKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Escape") {
      event.preventDefault();
      stopAddingTag(true);
      return;
    }

    if (event.key === "ArrowDown" && tagOptions.length > 0) {
      event.preventDefault();
      setActiveOptionIndex((index) => (index + 1) % tagOptions.length);
      return;
    }

    if (event.key === "ArrowUp" && tagOptions.length > 0) {
      event.preventDefault();
      setActiveOptionIndex(
        (index) => (index - 1 + tagOptions.length) % tagOptions.length,
      );
    }
  }

  return (
    <section className="note-properties" aria-label="Note properties">
      <div className="note-tags-row">
        <span className="note-properties-label">Tags</span>
        <div className="note-tag-list">
          {document.tags.map((tag) => (
            <span className="note-tag" key={tag}>
              <span>{tag}</span>
              <button
                className="note-tag-remove"
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => removeTagFromProperties(document, tag)}
              >
                ×
              </button>
            </span>
          ))}

          {addingTag ? (
            <form
              ref={tagFormRef}
              className="note-tag-form"
              onSubmit={submitTag}
            >
              <input
                autoFocus
                className="note-tag-input"
                value={tagInput}
                placeholder="Tag"
                aria-label="Add tag"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={tagOptions.length > 0}
                aria-controls={tagOptions.length > 0 ? listboxId : undefined}
                aria-activedescendant={
                  resolvedActiveOptionIndex >= 0
                    ? `${listboxId}-option-${resolvedActiveOptionIndex}`
                    : undefined
                }
                onChange={(event) => {
                  setTagInput(event.target.value);
                  setActiveOptionIndex(0);
                }}
                onKeyDown={handleTagInputKeyDown}
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    nextTarget instanceof Node &&
                    tagFormRef.current?.contains(nextTarget)
                  ) {
                    return;
                  }
                  stopAddingTag();
                }}
              />

              {tagOptions.length > 0 ? (
                <div
                  className="note-tag-suggestions"
                  id={listboxId}
                  role="listbox"
                  aria-label="Tag suggestions"
                >
                  {tagOptions.map((option, index) => (
                    <button
                      className="note-tag-suggestion"
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === resolvedActiveOptionIndex}
                      tabIndex={-1}
                      key={`${option.kind}:${option.tag}`}
                      onPointerDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveOptionIndex(index)}
                      onClick={() => addTag(option.tag)}
                    >
                      <span className="note-tag-suggestion-symbol" aria-hidden="true">
                        {option.kind === "create" ? "+" : "#"}
                      </span>
                      <span>
                        {option.kind === "create"
                          ? `Create “${option.tag}”`
                          : option.tag}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </form>
          ) : (
            <button
              ref={addTagButtonRef}
              className="note-tag-add"
              type="button"
              aria-label="Add tag"
              onClick={() => {
                setActiveOptionIndex(0);
                setAddingTag(true);
              }}
            >
              <span aria-hidden="true">＋</span>
              <span>Add tag</span>
            </button>
          )}
        </div>
      </div>

      <dl className="note-properties-grid">
        <div>
          <dt>Created</dt>
          <dd>{renderTimestamp(document.createdAt)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{renderTimestamp(document.updatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function getTagAssignmentOptions(
  projectTags: readonly string[],
  currentTags: readonly string[],
  query: string,
): TagAssignmentOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const currentTagSet = new Set(currentTags);

  const existing = projectTags
    .filter((tag) => !currentTagSet.has(tag))
    .filter(
      (tag) =>
        normalizedQuery.length === 0 ||
        tag.toLocaleLowerCase().includes(normalizedQuery),
    )
    .map(
      (tag): TagAssignmentOption => ({
        kind: "existing",
        tag,
      }),
    );

  const newTag = query.trim();
  if (
    newTag.length > 0 &&
    !currentTagSet.has(newTag) &&
    !projectTags.includes(newTag)
  ) {
    existing.push({ kind: "create", tag: newTag });
  }

  return existing;
}

export function getNoteMetadataSnapshot(document: NoteDocument): string {
  return JSON.stringify([
    document.createdAt,
    document.updatedAt,
    document.tags,
  ]);
}

export function addTagFromInput(
  document: NoteDocument,
  input: string,
): "added" | "duplicate" | "empty" {
  const normalized = input.trim();
  if (!normalized) return "empty";
  if (document.tags.includes(normalized)) return "duplicate";

  document.addTag(normalized);
  return "added";
}

export function removeTagFromProperties(
  document: NoteDocument,
  tag: string,
): void {
  document.removeTag(tag);
}

export function formatNoteTimestamp(
  timestamp: number | null,
  locales?: Intl.LocalesArgument,
): string {
  if (timestamp === null) return "Unavailable";

  if (locales === undefined) {
    return dateTimeFormatter.format(new Date(timestamp));
  }

  return new Intl.DateTimeFormat(locales, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function renderTimestamp(timestamp: number | null) {
  if (timestamp === null) return <span>Unavailable</span>;

  return (
    <time dateTime={new Date(timestamp).toISOString()}>
      {formatNoteTimestamp(timestamp)}
    </time>
  );
}
