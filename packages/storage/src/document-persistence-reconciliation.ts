import type { NoteDocument, NoteProject } from "@floe-note/document";
import { parseDocumentId } from "@floe-note/domain";

export type DocumentSubscriptionSet = Map<string, () => void>;

export function reconcileDocumentSubscriptions(
  documents: readonly NoteDocument[],
  subscriptions: DocumentSubscriptionSet,
  attach: (document: NoteDocument) => void,
): void {
  const currentDocuments = new Map(
    documents.map((document) => [document.id, document] as const),
  );

  for (const [documentId, unsubscribe] of subscriptions) {
    if (currentDocuments.has(documentId)) continue;

    unsubscribe();
    subscriptions.delete(documentId);
  }

  for (const document of currentDocuments.values()) {
    if (!subscriptions.has(document.id)) {
      attach(document);
    }
  }
}

export function shouldPersistDocumentReference(
  project: NoteProject,
  document: NoteDocument,
): boolean {
  return project
    .getAllDocuments()
    .some(
      (candidate) =>
        candidate.id === document.id && candidate === document,
    );
}

export function filterLoadableDocumentRows<T extends { documentId: string }>(
  project: NoteProject,
  rows: readonly T[],
): T[] {
  return rows.filter(
    (row) => !project.isDocumentPurged(parseDocumentId(row.documentId)),
  );
}

export function staleDocumentRowIds<T extends { documentId: string }>(
  currentDocuments: readonly NoteDocument[],
  rows: readonly T[],
): string[] {
  const currentIds = new Set(
    currentDocuments.map((document) => document.id as string),
  );
  return rows
    .filter((row) => !currentIds.has(row.documentId))
    .map((row) => row.documentId);
}
