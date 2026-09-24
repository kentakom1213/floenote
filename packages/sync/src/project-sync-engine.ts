import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { Transport } from "@floe-note/transport";

import { decodeSyncMessage, encodeSyncMessage } from "./protocol.js";

export type SyncDebugEvent = {
  at: string;
  event: string;
  details: Record<string, unknown>;
};

export type SyncDebugLogger = (event: SyncDebugEvent) => void;

export type ProjectSyncEngineOptions = {
  debugLogger?: SyncDebugLogger;
};

export class ProjectSyncEngine {
  readonly #project: NoteProject;
  readonly #transport: Transport;
  readonly #debugLogger: SyncDebugLogger | null;
  readonly #documentSubscriptions = new Map<string, () => void>();
  #stopProjectSubscription: (() => void) | null = null;
  #stopManifestSubscription: (() => void) | null = null;
  #stopTransportSubscription: (() => void) | null = null;
  #started = false;

  constructor(
    project: NoteProject,
    transport: Transport,
    options: ProjectSyncEngineOptions = {},
  ) {
    this.#project = project;
    this.#transport = transport;
    this.#debugLogger = options.debugLogger ?? null;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#debug("engine.start", {
      documents: this.#project.getAllDocuments().length,
    });

    this.#reconcileDocumentSubscriptions(false);

    this.#stopProjectSubscription = this.#project.subscribe(() => {
      this.#debug("project.changed", {
        documents: this.#project.getAllDocuments().length,
      });

      this.#reconcileDocumentSubscriptions(true);
    });

    this.#stopManifestSubscription =
      this.#project.subscribeManifestLocalUpdates((update) => {
        this.#debug("manifest.local-update", {
          bytes: update.byteLength,
        });

        this.#transport.send(
          encodeSyncMessage({ type: "manifest-update", update }),
        );
      });

    this.#stopTransportSubscription = this.#transport.onMessage((data) => {
      this.#debug("transport.receive", {
        bytes: data.byteLength,
      });
      this.#handleMessage(data);
    });

    this.#debug("hello.send");
    this.#transport.send(encodeSyncMessage({ type: "hello" }));
    this.#sendFullState();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    this.#debug("engine.stop", {
      documentSubscriptions: this.#documentSubscriptions.size,
    });

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

  #reconcileDocumentSubscriptions(announceNew: boolean): void {
    const currentDocuments = new Map<string, NoteDocument>(
      this.#project
        .getAllDocuments()
        .map((document) => [document.id, document] as const),
    );

    for (const [documentId, unsubscribe] of this.#documentSubscriptions) {
      if (currentDocuments.has(documentId)) continue;

      this.#debug("document.detach", { documentId });
      unsubscribe();
      this.#documentSubscriptions.delete(documentId);
    }

    for (const document of currentDocuments.values()) {
      this.#attachDocument(document, announceNew);
    }
  }

  #attachDocument(document: NoteDocument, announce: boolean): void {
    if (this.#documentSubscriptions.has(document.id)) return;

    this.#debug("document.attach", {
      documentId: document.id,
      announce,
    });

    const unsubscribe = document.subscribeLocalUpdates((update) => {
      this.#debug("document.local-update", {
        documentId: document.id,
        bytes: update.byteLength,
      });

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
    const manifest = this.#project.exportManifestUpdate();

    this.#debug("full-state.send", {
      manifestBytes: manifest.byteLength,
      documents: this.#project.getAllDocuments().length,
    });

    this.#transport.send(
      encodeSyncMessage({
        type: "manifest-update",
        update: manifest,
      }),
    );

    for (const document of this.#project.getAllDocuments()) {
      this.#sendDocument(document);
    }
  }

  #sendDocument(document: NoteDocument): void {
    const update = document.exportUpdate();

    this.#debug("document.send", {
      documentId: document.id,
      bytes: update.byteLength,
    });

    this.#transport.send(
      encodeSyncMessage({
        type: "document-update",
        documentId: document.id,
        update,
      }),
    );
  }

  #handleMessage(data: Uint8Array): void {
    try {
      const message = decodeSyncMessage(data);

      switch (message.type) {
        case "hello":
          this.#debug("hello.receive");
          this.#sendFullState();
          return;

        case "manifest-update":
          this.#debug("manifest.receive", {
            bytes: message.update.byteLength,
          });
          this.#project.importManifestUpdate(message.update);
          return;

        case "document-update":
          this.#debug("document.receive", {
            documentId: message.documentId,
            bytes: message.update.byteLength,
          });
          this.#project.importDocumentUpdate(
            message.documentId,
            message.update,
          );
          return;
      }
    } catch (error) {
      this.#debug("message.error", {
        bytes: data.byteLength,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #debug(event: string, details: Record<string, unknown> = {}): void {
    this.#debugLogger?.({
      at: new Date().toISOString(),
      event,
      details,
    });
  }
}
