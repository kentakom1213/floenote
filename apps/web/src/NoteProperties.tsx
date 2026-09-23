import type { NoteDocument } from "@floe-note/document";
import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";

type NotePropertiesProps = {
  document: NoteDocument;
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NoteProperties({ document }: NotePropertiesProps) {
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
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");

  function stopAddingTag(restoreFocus = false): void {
    setTagInput("");
    setAddingTag(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => addTagButtonRef.current?.focus());
    }
  }

  function submitTag(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const result = addTagFromInput(document, tagInput);
    if (result !== "empty") {
      stopAddingTag();
    }
  }

  function handleTagInputKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key !== "Escape") return;

    event.preventDefault();
    stopAddingTag(true);
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
            <form className="note-tag-form" onSubmit={submitTag}>
              <input
                autoFocus
                className="note-tag-input"
                value={tagInput}
                placeholder="Tag"
                aria-label="New tag"
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagInputKeyDown}
                onBlur={() => stopAddingTag()}
              />
            </form>
          ) : (
            <button
              ref={addTagButtonRef}
              className="note-tag-add"
              type="button"
              onClick={() => setAddingTag(true)}
            >
              <span aria-hidden="true">＋</span>
              <span>Add tag</span>
            </button>
          )}
        </div>
      </div>

      <details className="note-properties-details">
        <summary>Properties</summary>
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
      </details>
    </section>
  );
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
