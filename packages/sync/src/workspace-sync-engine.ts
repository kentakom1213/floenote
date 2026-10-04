import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";
import type { Transport } from "@floe-note/transport";

import { decodeSyncMessage, encodeSyncMessage } from "./protocol.js";

export type SyncDebugEvent = {
  at: string;
  event: string;
  details: Record<string, unknown>;
};

export type SyncDebugLogger = (event: SyncDebugEvent) => void;

export type WorkspaceSyncEngineOptions = {
  debugLogger?: SyncDebugLogger;
  onInitialRemoteStateReceived?: () => void;
  onInitialSyncError?: (error: Error) => void;
  onRemoteDocumentVersionConfirmed?: (
    documentId: DocumentId,
    frontiers: Uint8Array,
  ) => void;
  relayScope?: "local-tab" | "remote-peer";
};

// Bridge transports attached to one in-memory Workspace without echoing an
// imported update back through the transport that delivered it.
const relayEngines = new WeakMap<NoteProject, Set<WorkspaceSyncEngine>>();

export class WorkspaceSyncEngine {
  readonly #project: NoteProject;
  readonly #transport: Transport;
  readonly #debugLogger: SyncDebugLogger | null;
  readonly #onInitialRemoteStateReceived: (() => void) | null;
  readonly #onInitialSyncError: ((error: Error) => void) | null;
  readonly #onRemoteDocumentVersionConfirmed:
    | ((documentId: DocumentId, frontiers: Uint8Array) => void)
    | null;
  readonly #relayScope: "local-tab" | "remote-peer" | null;
  readonly #documentSubscriptions = new Map<string, () => void>();
  #stopProjectSubscription: (() => void) | null = null;
  #stopManifestSubscription: (() => void) | null = null;
  #stopTransportSubscription: (() => void) | null = null;
  #initialRemoteStateReceived = false;
  #initialRemoteStateFailed = false;
  #remoteSupportsDocumentAck = false;
  #started = false;

  constructor(
    project: NoteProject,
    transport: Transport,
    options: WorkspaceSyncEngineOptions = {},
  ) {
    this.#project = project;
    this.#transport = transport;
    this.#debugLogger = options.debugLogger ?? null;
    this.#onInitialRemoteStateReceived =
      options.onInitialRemoteStateReceived ?? null;
    this.#onInitialSyncError = options.onInitialSyncError ?? null;
    this.#onRemoteDocumentVersionConfirmed =
      options.onRemoteDocumentVersionConfirmed ?? null;
    this.#relayScope = options.relayScope ?? null;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    if (this.#relayScope) {
      let engines = relayEngines.get(this.#project);
      if (!engines) {
        engines = new Set();
        relayEngines.set(this.#project, engines);
      }
      engines.add(this);
    }

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

    const engines = relayEngines.get(this.#project);
    engines?.delete(this);
    if (engines?.size === 0) relayEngines.delete(this.#project);

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

    this.#transport.send(
      encodeSyncMessage({
        type: "full-state-end",
        supportsDocumentAck: true,
      }),
    );
    this.#debug("full-state.end.send");
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

  #sendDocumentAck(document: NoteDocument): void {
    this.#transport.send(
      encodeSyncMessage({
        type: "document-ack",
        documentId: document.id,
        frontiers: document.captureHistoryFrontiers(),
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

        case "full-state-end":
          this.#debug("full-state.end.receive");
          this.#remoteSupportsDocumentAck =
            message.supportsDocumentAck === true;
          if (this.#initialRemoteStateFailed) {
            this.#debug("full-state.end.ignore", {
              reason: "initial-sync-failed",
            });
            return;
          }
          if (!this.#initialRemoteStateReceived) {
            this.#initialRemoteStateReceived = true;
            this.#onInitialRemoteStateReceived?.();
          }
          if (
            this.#remoteSupportsDocumentAck &&
            this.#onRemoteDocumentVersionConfirmed
          ) {
            for (const document of this.#project.getAllDocuments()) {
              this.#sendDocumentAck(document);
            }
          }
          return;

        case "manifest-update":
          this.#debug("manifest.receive", {
            bytes: message.update.byteLength,
          });
          this.#project.importManifestUpdate(message.update);
          this.#relayImportedUpdate(data);
          return;

        case "document-update": {
          this.#debug("document.receive", {
            documentId: message.documentId,
            bytes: message.update.byteLength,
          });
          const importedDocument = this.#project.importDocumentUpdate(
            message.documentId,
            message.update,
          );
          if (importedDocument) {
            this.#relayImportedUpdate(data);
            if (
              this.#remoteSupportsDocumentAck &&
              this.#onRemoteDocumentVersionConfirmed
            ) {
              this.#sendDocumentAck(importedDocument);
            }
          }
          return;
        }

        case "document-ack":
          this.#debug("document.ack.receive", {
            documentId: message.documentId,
          });
          this.#onRemoteDocumentVersionConfirmed?.(
            message.documentId,
            message.frontiers,
          );
          return;
      }
    } catch (error) {
      const syncError =
        error instanceof Error ? error : new Error(String(error));

      this.#debug("message.error", {
        bytes: data.byteLength,
        error: syncError.message,
      });

      if (
        !this.#initialRemoteStateReceived &&
        !this.#initialRemoteStateFailed
      ) {
        this.#initialRemoteStateFailed = true;
        this.#onInitialSyncError?.(syncError);
      }
    }
  }

  #relayImportedUpdate(data: Uint8Array): void {
    if (!this.#relayScope) return;

    for (const engine of relayEngines.get(this.#project) ?? []) {
      if (engine.#relayScope !== this.#relayScope && engine.#started) {
        engine.#transport.send(data);
      }
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
