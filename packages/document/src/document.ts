import type { DocumentId } from "@floe-note/domain";
import { LoroDoc, type LoroText } from "loro-crdt";

export type DocumentEditorBinding = {
  doc: LoroDoc;
  getText: (doc: LoroDoc) => LoroText;
};

export class NoteDocument {
  readonly id: DocumentId;
  readonly #doc: LoroDoc;

  constructor(id: DocumentId, title: string, now = Date.now()) {
    this.id = id;
    this.#doc = new LoroDoc();

    const meta = this.#doc.getMap("meta");
    meta.set("title", title);
    meta.set("createdAt", now);
    meta.set("updatedAt", now);
    meta.ensureMergeableList("tags");
    this.#doc.getText("body");
    this.#doc.commit();
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

  getEditorBinding(): DocumentEditorBinding {
    return {
      doc: this.#doc,
      getText: (doc) => doc.getText("body"),
    };
  }
}
