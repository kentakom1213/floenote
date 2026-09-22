import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { Transport } from "@floe-note/transport";

import { decodeSyncMessage, encodeSyncMessage } from "./protocol.js";

export class ProjectSyncEngine {
  readonly #project: NoteProject;
  readonly #transport: Transport;
  readonly #documentSubscriptions = new Map<string, () => void>();
  #stopProjectSubscription: (() => void) | null = null;
  #stopManifestSubscription: (() => void) | null = null;
  #stopTransportSubscription: (() => void) | null = null;
  #started = false;

  constructor(project: NoteProject, transport: Transport) {
    this.#project = project;
    this.#transport = transport;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    for (const document of this.#project.getAllDocuments()) {
      this.#attachDocument(document, false);
    }

    this.#stopProjectSubscription = this.#project.subscribe(() => {
      for (const document of this.#project.getAllDocuments()) {
        this.#attachDocument(document, true);
      }
    });

    this.#stopManifestSubscription =
      this.#project.subscribeManifestLocalUpdates((update) => {
        this.#transport.send(
          encodeSyncMessage({ type: "manifest-update", update }),
        );
      });

    this.#stopTransportSubscription = this.#transport.onMessage((data) => {
      this.#handleMessage(data);
    });

    this.#transport.send(encodeSyncMessage({ type: "hello" }));
    this.#sendFullState();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    this.#stopProjectSubscription?.();
    this.#stopManifestSubscription?.();
    this.#stopTransportSubscription?.();
    this.#stopProjectSubscription = null;
    this.#stopManifestSubscription = null;
    this.#stopTransportSubscription = null;

    for (const unsubscribe of this.#documentSubscriptions.values()) {
      unsubscribe();
    }
    this.#documentSubscriptions.clear();

    this.#transport.close();
  }

  #attachDocument(document: NoteDocument, announce: boolean): void {
    if (this.#documentSubscriptions.has(document.id)) return;

    const unsubscribe = document.subscribeLocalUpdates((update) => {
      this.#transport.send(
        encodeSyncMessage({
          type: "document-update",
          documentId: document.id,
          update,
        }),
      );
    });

    this.#documentSubscriptions.set(document.id, unsubscribe);

    if (announce) {
      this.#sendDocument(document);
    }
  }

  #sendFullState(): void {
    this.#transport.send(
      encodeSyncMessage({
        type: "manifest-update",
        update: this.#project.exportManifestUpdate(),
      }),
    );

    for (const document of this.#project.getAllDocuments()) {
      this.#sendDocument(document);
    }
  }

  #sendDocument(document: NoteDocument): void {
    this.#transport.send(
      encodeSyncMessage({
        type: "document-update",
        documentId: document.id,
        update: document.exportUpdate(),
      }),
    );
  }

  #handleMessage(data: Uint8Array): void {
    try {
      const message = decodeSyncMessage(data);

      switch (message.type) {
        case "hello":
          this.#sendFullState();
          return;

        case "manifest-update":
          this.#project.importManifestUpdate(message.update);
          return;

        case "document-update":
          this.#project.importDocumentUpdate(
            message.documentId,
            message.update,
          );
          return;
      }
    } catch {
      return;
    }
  }
}
