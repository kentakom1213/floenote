import {
  DEFAULT_TAG_COLOR,
  TAG_COLORS,
  type NoteDocument,
  type TagColor,
} from "@floe-note/document";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { TagChip } from "./TagChip.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

type NotePropertiesProps = {
  document: NoteDocument;
  availableTags?: readonly string[];
  getTagColor?: (tag: string) => TagColor;
  onTagColorChange?: (tag: string, color: TagColor) => void;
  trailingControl?: ReactNode;
};

export type TagAssignmentOption = {
  kind: "existing" | "create";
  tag: string;
};

type TagColorPaletteProps = {
  tag: string;
  currentColor: TagColor;
  onChange: (color: TagColor) => void;
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NoteProperties({
  document,
  availableTags = [],
  getTagColor = () => DEFAULT_TAG_COLOR,
  onTagColorChange = () => {},
  trailingControl,
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
    const command = getTagInputCommand(
      event.key,
      activeOptionIndex,
      tagOptions.length,
    );
    if (!command) return;

    event.preventDefault();
    if (command.type === "close") {
      stopAddingTag(true);
      return;
    }

    setActiveOptionIndex(command.index);
  }

  return (
    <section className="note-properties" aria-label="Note properties">
      <div className="note-tags-row">
        <span className="note-properties-label">Tags</span>
        <div className="note-tag-list">
          {document.tags.map((tag) => {
            const color = getTagColor(tag);
            return (
              <span
                className="note-tag-control"
                data-tag-color={color}
                key={tag}
              >
                <NoteTagColorControl
                  tag={tag}
                  color={color}
                  onColorChange={(nextColor) =>
                    onTagColorChange(tag, nextColor)
                  }
                />
                <button
                  className="note-tag-remove"
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => removeTagFromProperties(document, tag)}
                >
                  ×
                </button>
              </span>
            );
          })}

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
                      {option.kind === "create" ? (
                        <>
                          <span
                            className="note-tag-suggestion-symbol"
                            aria-hidden="true"
                          >
                            +
                          </span>
                          <span>{`Create “${option.tag}”`}</span>
                        </>
                      ) : (
                        <TagChip
                          tag={option.tag}
                          color={getTagColor(option.tag)}
                          compact
                        />
                      )}
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

      <div className="note-properties-footer">
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
        {trailingControl ? (
          <div className="note-properties-trailing">{trailingControl}</div>
        ) : null}
      </div>
    </section>
  );
}

function NoteTagColorControl({
  tag,
  color,
  onColorChange,
}: {
  tag: string;
  color: TagColor;
  onColorChange: (color: TagColor) => void;
}) {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(pickerRef);

  return (
    <details className="note-tag-color-picker" ref={pickerRef}>
      <summary
        className="note-tag-color-summary"
        aria-label={`Change ${tag} color`}
        title={`Change ${tag} color`}
      >
        <TagChip tag={tag} color={color} />
      </summary>
      <div className="tag-color-popover">
        <p className="tag-color-popover-label">{tag}</p>
        <TagColorPalette
          tag={tag}
          currentColor={color}
          onChange={(nextColor) => {
            onColorChange(nextColor);
            pickerRef.current?.removeAttribute("open");
          }}
        />
      </div>
    </details>
  );
}

export function TagColorPalette({
  tag,
  currentColor,
  onChange,
}: TagColorPaletteProps) {
  return (
    <div
      className="tag-color-palette"
      role="group"
      aria-label={`Color for ${tag}`}
    >
      {TAG_COLORS.map((color) => (
        <button
          className="tag-color-option"
          type="button"
          data-tag-color={color}
          aria-label={`Set ${tag} color to ${color}`}
          aria-pressed={currentColor === color}
          key={color}
          onClick={() => onChange(color)}
        >
          <span className="tag-color-swatch" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export type TagInputCommand =
  | { type: "close" }
  | { type: "move"; index: number }
  | null;

export function getTagInputCommand(
  key: string,
  currentIndex: number,
  optionCount: number,
): TagInputCommand {
  if (key === "Escape") return { type: "close" };
  if (key === "ArrowDown" && optionCount > 0) {
    return {
      type: "move",
      index: moveTagOptionIndex(currentIndex, optionCount, "next"),
    };
  }
  if (key === "ArrowUp" && optionCount > 0) {
    return {
      type: "move",
      index: moveTagOptionIndex(currentIndex, optionCount, "previous"),
    };
  }
  return null;
}

export function moveTagOptionIndex(
  currentIndex: number,
  optionCount: number,
  direction: "next" | "previous",
): number {
  if (optionCount <= 0) return 0;
  return direction === "next"
    ? (currentIndex + 1) % optionCount
    : (currentIndex - 1 + optionCount) % optionCount;
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
