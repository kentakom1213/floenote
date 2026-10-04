import type {
  EditHistoryCheckpoint,
  NoteDocument,
} from "@floe-note/document";
import type { CheckpointId } from "@floe-note/domain";

import { renderMarkdown } from "./MarkdownPreview.js";

type EditHistoryPanelProps = {
  checkpoints: readonly EditHistoryCheckpoint[];
  selectedCheckpointId: CheckpointId | null;
  onSelectCheckpoint: (checkpointId: CheckpointId) => void;
  onSelectCurrent: () => void;
  onClose: () => void;
};

export function EditHistoryPanel({
  checkpoints,
  selectedCheckpointId,
  onSelectCheckpoint,
  onSelectCurrent,
  onClose,
}: EditHistoryPanelProps) {
  return (
    <aside className="edit-history-panel" aria-label="Edit history">
      <header className="edit-history-panel-header">
        <strong>History</strong>
        <button
          className="edit-history-close"
          type="button"
          aria-label="Close history"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="edit-history-list">
        <button
          className={
            selectedCheckpointId === null
              ? "edit-history-item selected"
              : "edit-history-item"
          }
          type="button"
          onClick={onSelectCurrent}
        >
          <span className="edit-history-current-dot" aria-hidden="true" />
          <span>Current</span>
        </button>

        {checkpoints.length > 0 ? (
          checkpoints.map((checkpoint) => (
            <button
              className={
                checkpoint.id === selectedCheckpointId
                  ? "edit-history-item selected"
                  : "edit-history-item"
              }
              type="button"
              key={checkpoint.id}
              onClick={() => onSelectCheckpoint(checkpoint.id)}
            >
              <span className="edit-history-item-time">
                {formatCheckpointTime(checkpoint.createdAt)}
              </span>
              {checkpoint.restoreSourceCheckpointId ? (
                <span className="edit-history-item-kind">Restored</span>
              ) : null}
            </button>
          ))
        ) : (
          <p className="edit-history-empty">
            Versions appear here after you edit this note.
          </p>
        )}
      </div>
    </aside>
  );
}

type HistoricalVersionViewProps = {
  checkpoint: EditHistoryCheckpoint;
  document: NoteDocument;
  currentDocument: NoteDocument;
  onBackToCurrent: () => void;
  onRestore: () => void;
};

export function HistoricalVersionView({
  checkpoint,
  document,
  currentDocument,
  onBackToCurrent,
  onRestore,
}: HistoricalVersionViewProps) {
  const bodyDiff = renderInlineHistoryDiff(
    document.bodyText,
    currentDocument.bodyText,
  );

  return (
    <section className="historical-version-view">
      <div className="historical-version-banner">
        <div>
          <strong>Version from {formatCheckpointTime(checkpoint.createdAt)}</strong>
          <span>Compared with current · read-only</span>
        </div>
        <div className="historical-version-actions">
          <button type="button" onClick={onBackToCurrent}>
            Back to current
          </button>
          <button
            className="historical-version-restore"
            type="button"
            onClick={onRestore}
          >
            Restore this version
          </button>
        </div>
      </div>

      <header className="historical-version-header">
        <h1>{document.title || "Untitled"}</h1>
        {document.tags.length > 0 ? (
          <div className="historical-version-tags" aria-label="Historical tags">
            {document.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </header>

      <div
        className="markdown-preview historical-inline-diff"
        aria-label="Historical version compared with current"
        dangerouslySetInnerHTML={{ __html: bodyDiff.html }}
      />

      <p className="historical-version-restore-note">
        Restoring applies this content as a new edit. Your current state remains
        available in history.
      </p>
    </section>
  );
}

type DiffOperation = {
  kind: "equal" | "added" | "removed";
  text: string;
};

export function renderInlineHistoryDiff(
  historical: string,
  current: string,
): { html: string; hasChanges: boolean } {
  if (historical === current) {
    return {
      html: renderMarkdown(historical),
      hasChanges: false,
    };
  }

  const lines = createLineOperations(historical, current);
  const output: string[] = [];

  for (let index = 0; index < lines.length;) {
    const operation = lines[index]!;
    if (operation.kind === "equal") {
      output.push(operation.text);
      index += 1;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];

    while (index < lines.length && lines[index]!.kind !== "equal") {
      const changed = lines[index]!;
      if (changed.kind === "removed") removed.push(changed.text);
      if (changed.kind === "added") added.push(changed.text);
      index += 1;
    }

    const paired = Math.min(removed.length, added.length);
    for (let pair = 0; pair < paired; pair += 1) {
      output.push(renderChangedLine(removed[pair]!, added[pair]!));
    }
    for (let rest = paired; rest < removed.length; rest += 1) {
      output.push(renderWholeLineChange(removed[rest]!, "removed"));
    }
    for (let rest = paired; rest < added.length; rest += 1) {
      output.push(renderWholeLineChange(added[rest]!, "added"));
    }
  }

  return {
    html: renderMarkdown(output.join("\n")),
    hasChanges: true,
  };
}

function renderChangedLine(before: string, after: string): string {
  const beforeParts = splitMarkdownLinePrefix(before);
  const afterParts = splitMarkdownLinePrefix(after);

  if (beforeParts.prefix !== afterParts.prefix) {
    return [
      renderWholeLineChange(before, "removed"),
      renderWholeLineChange(after, "added"),
    ].join("\n");
  }

  return beforeParts.prefix + createTokenOperations(
    beforeParts.content,
    afterParts.content,
  )
    .map((operation) => {
      switch (operation.kind) {
        case "equal":
          return operation.text;
        case "removed":
          return '<del class="historical-diff-removed">' + operation.text + "</del>";
        case "added":
          return '<mark class="historical-diff-added">' + operation.text + "</mark>";
      }
    })
    .join("");
}

function renderWholeLineChange(
  line: string,
  kind: "added" | "removed",
): string {
  const { prefix, content } = splitMarkdownLinePrefix(line);
  if (!content) return line;

  return kind === "added"
    ? prefix + '<mark class="historical-diff-added">' + content + "</mark>"
    : prefix + '<del class="historical-diff-removed">' + content + "</del>";
}

function splitMarkdownLinePrefix(line: string): {
  prefix: string;
  content: string;
} {
  const match = /^(\s{0,3}(?:(?:#{1,6}|>)\s+|(?:[-+*]|\d+[.)])\s+)?)(.*)$/u.exec(
    line,
  );
  return {
    prefix: match?.[1] ?? "",
    content: match?.[2] ?? line,
  };
}

function createLineOperations(
  before: string,
  after: string,
): DiffOperation[] {
  return createSequenceOperations(before.split("\n"), after.split("\n"));
}

function createTokenOperations(
  before: string,
  after: string,
): DiffOperation[] {
  return createSequenceOperations(tokenizeDiffText(before), tokenizeDiffText(after));
}

function tokenizeDiffText(value: string): string[] {
  return value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) ?? [];
}

function createSequenceOperations(
  before: readonly string[],
  after: readonly string[],
): DiffOperation[] {
  const lengths = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1),
  );

  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lengths[left]![right] =
        before[left] === after[right]
          ? lengths[left + 1]![right + 1]! + 1
          : Math.max(
              lengths[left + 1]![right]!,
              lengths[left]![right + 1]!,
            );
    }
  }

  const operations: DiffOperation[] = [];
  let left = 0;
  let right = 0;

  while (left < before.length || right < after.length) {
    if (
      left < before.length &&
      right < after.length &&
      before[left] === after[right]
    ) {
      operations.push({ kind: "equal", text: before[left]! });
      left += 1;
      right += 1;
      continue;
    }

    if (
      right < after.length &&
      (left === before.length ||
        lengths[left]![right + 1]! >= lengths[left + 1]![right]!)
    ) {
      operations.push({ kind: "added", text: after[right]! });
      right += 1;
      continue;
    }

    operations.push({ kind: "removed", text: before[left]! });
    left += 1;
  }

  return operations;
}

export function formatCheckpointTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
