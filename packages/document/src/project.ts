import {
  createDocumentId,
  createProjectId,
  type DocumentId,
  type ProjectId,
} from "@floe-note/domain";
import { LoroDoc } from "loro-crdt";

import { NoteDocument } from "./document.js";

export type DocumentSummary = {
  id: DocumentId;
  title: string;
};

type Listener = () => void;

export class NoteProject {
  readonly id: ProjectId;
  readonly #manifest = new LoroDoc();
  readonly #documents = new Map<DocumentId, NoteDocument>();
  readonly #listeners = new Set<Listener>();

  constructor(id: ProjectId = createProjectId()) {
    this.id = id;
    this.#manifest.getMap("documents");
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  listDocuments(): DocumentSummary[] {
    const manifest = this.#manifest.getMap("documents");

    return manifest
      .entries()
      .filter(([, status]) => status === "active")
      .flatMap(([id]) => {
        const document = this.#documents.get(id as DocumentId);
        return document ? [{ id: document.id, title: document.title }] : [];
      });
  }

  createDocument(title = "Untitled"): NoteDocument {
    const id = createDocumentId();
    const document = new NoteDocument(id, title);

    this.#documents.set(id, document);
    this.#manifest.getMap("documents").set(id, "active");
    this.#manifest.commit();
    this.#emit();

    return document;
  }

  getDocument(id: DocumentId): NoteDocument | undefined {
    const status = this.#manifest.getMap("documents").get(id);
    return status === "active" ? this.#documents.get(id) : undefined;
  }

  renameDocument(id: DocumentId, title: string): void {
    const document = this.getDocument(id);
    if (!document) return;

    document.setTitle(title);
    this.#emit();
  }

  deleteDocument(id: DocumentId): void {
    const manifest = this.#manifest.getMap("documents");
    if (manifest.get(id) !== "active") return;

    manifest.set(id, "deleted");
    this.#manifest.commit();
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
