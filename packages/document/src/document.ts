import type { DocumentId } from "@floe-note/domain";
import { LoroDoc, type LoroText } from "loro-crdt";

export type DocumentEditorBinding = {
  doc: LoroDoc;
  getText: (doc: LoroDoc) => LoroText;
};

export class NoteDocument {
  readonly id: DocumentId;
  readonly #doc: LoroDoc;

  private constructor(id: DocumentId, doc: LoroDoc) {
    this.id = id;
    this.#doc = doc;
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

  setTitle(title: string): void {
    const meta = this.#doc.getMap("meta");
    meta.set("title", title);
    meta.set("updatedAt", Date.now());
    this.#doc.commit();
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
}
