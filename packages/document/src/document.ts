import type { DocumentId } from "@floe-note/domain";
import { LoroDoc, LoroList, type LoroText } from "loro-crdt";

export type DocumentEditorBinding = {
  doc: LoroDoc;
  getText: (doc: LoroDoc) => LoroText;
};

export type NoteDocumentInitialState = {
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  tags: readonly string[];
};

export class NoteDocument {
  readonly id: DocumentId;
  readonly #doc: LoroDoc;
  #suppressAutomaticTimestamp = false;
  #automaticTimestampPending = false;

  private constructor(id: DocumentId, doc: LoroDoc) {
    this.id = id;
    this.#doc = doc;

    this.#doc.subscribeLocalUpdates(() => {
      if (this.#suppressAutomaticTimestamp || this.#automaticTimestampPending) {
        return;
      }

      this.#automaticTimestampPending = true;
      void Promise.resolve().then(() => {
        this.#automaticTimestampPending = false;

        this.#withAutomaticTimestampSuppressed(() => {
          this.#doc.getMap("meta").set("updatedAt", Date.now());
          this.#doc.commit();
        });
      });
    });
  }

  static create(id: DocumentId, title: string, now = Date.now()): NoteDocument {
    const doc = new LoroDoc();
    const meta = doc.getMap("meta");

    meta.set("title", title);
    meta.set("createdAt", now);
    meta.set("updatedAt", now);
    meta.ensureMergeableList("tags");
    doc.getText("body");
    doc.commit();

    return new NoteDocument(id, doc);
  }

  static createWithInitialState(
    id: DocumentId,
    initial: NoteDocumentInitialState,
  ): NoteDocument {
    assertInitialTimestamp(initial.createdAt, "createdAt");
    assertInitialTimestamp(initial.updatedAt, "updatedAt");

    const doc = new LoroDoc();
    const meta = doc.getMap("meta");
    meta.set("title", initial.title);
    meta.set("createdAt", initial.createdAt);
    meta.set("updatedAt", initial.updatedAt);

    const tags = meta.ensureMergeableList("tags");
    initial.tags.forEach((tag, index) => {
      tags.insert(index, tag);
    });

    const body = doc.getText("body");
    if (initial.body.length > 0) {
      body.insert(0, initial.body);
    }
    doc.commit();

    return new NoteDocument(id, doc);
  }

  static empty(id: DocumentId): NoteDocument {
    return new NoteDocument(id, new LoroDoc());
  }

  static fromSnapshot(id: DocumentId, snapshot: Uint8Array): NoteDocument {
    return new NoteDocument(id, LoroDoc.fromSnapshot(snapshot));
  }

  get title(): string {
    const value = this.#doc.getMap("meta").get("title");
    return typeof value === "string" ? value : "";
  }

  get createdAt(): number | null {
    return this.#getTimestamp("createdAt");
  }

  get updatedAt(): number | null {
    return this.#getTimestamp("updatedAt");
  }

  get tags(): readonly string[] {
    return normalizeStoredTags(this.#getTagsList()?.toArray() ?? []);
  }

  setTitle(title: string): void {
    if (title === this.title) return;

    this.#commitLocalMutation(() => {
      this.#doc.getMap("meta").set("title", title);
    });
  }

  setTags(tags: readonly string[]): void {
    const normalized = normalizeTags(tags);
    if (sameStrings(normalized, this.tags)) return;

    this.#commitLocalMutation(() => {
      const list = this.#ensureTagsList();
      if (list.length > 0) list.delete(0, list.length);

      normalized.forEach((tag, index) => {
        list.insert(index, tag);
      });
    });
  }

  addTag(tag: string): void {
    const normalized = normalizeTag(tag);
    if (this.tags.includes(normalized)) return;

    this.#commitLocalMutation(() => {
      const list = this.#ensureTagsList();
      list.insert(list.length, normalized);
    });
  }

  removeTag(tag: string): void {
    const normalized = normalizeTag(tag);
    const list = this.#getTagsList();
    if (!list) return;

    const values = list.toArray();
    const indexes = values.flatMap((value, index) =>
      typeof value === "string" && value.trim() === normalized ? [index] : [],
    );
    if (indexes.length === 0) return;

    this.#commitLocalMutation(() => {
      for (const index of indexes.reverse()) {
        list.delete(index, 1);
      }
    });
  }

  get bodyText(): string {
    return this.#doc.getText("body").toString();
  }

  exportSnapshot(): Uint8Array {
    this.#doc.commit();
    return this.#doc.export({ mode: "snapshot" });
  }

  exportUpdate(): Uint8Array {
    this.#doc.commit();
    return this.#doc.export({ mode: "update" });
  }

  importUpdate(update: Uint8Array): void {
    this.#doc.import(update);
  }

  subscribe(listener: () => void): () => void {
    return this.#doc.subscribe(() => listener());
  }

  subscribeLocalUpdates(listener: (update: Uint8Array) => void): () => void {
    return this.#doc.subscribeLocalUpdates(listener);
  }

  getEditorBinding(): DocumentEditorBinding {
    return {
      doc: this.#doc,
      getText: (doc) => doc.getText("body"),
    };
  }

  #getTimestamp(key: "createdAt" | "updatedAt"): number | null {
    const value = this.#doc.getMap("meta").get(key);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  #getTagsList(): LoroList | null {
    const value = this.#doc.getMap("meta").get("tags");
    return value instanceof LoroList ? value : null;
  }

  #ensureTagsList(): LoroList {
    return this.#doc.getMap("meta").ensureMergeableList("tags");
  }

  #commitLocalMutation(mutate: () => void): void {
    this.#withAutomaticTimestampSuppressed(() => {
      mutate();
      this.#doc.getMap("meta").set("updatedAt", Date.now());
      this.#doc.commit();
    });
  }

  #withAutomaticTimestampSuppressed<T>(run: () => T): T {
    const previous = this.#suppressAutomaticTimestamp;
    this.#suppressAutomaticTimestamp = true;
    try {
      return run();
    } finally {
      this.#suppressAutomaticTimestamp = previous;
    }
  }
}

function normalizeTag(tag: string): string {
  const normalized = tag.trim();
  if (!normalized) {
    throw new TypeError("Tag must not be empty");
  }
  return normalized;
}

function normalizeTags(tags: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeStoredTags(values: readonly unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assertInitialTimestamp(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite timestamp`);
  }
}
