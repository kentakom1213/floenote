import {
  NoteDocument,
  NoteProject,
} from "@floe-note/document";
import type { Transport } from "@floe-note/transport";
import { describe, expect, it } from "vitest";

import { ProjectSyncEngine } from "../src/index.js";

class MemoryTransport implements Transport {
  #peer: MemoryTransport | null = null;
  readonly #handlers = new Set<(data: Uint8Array) => void>();
  #closed = false;

  connect(peer: MemoryTransport): void {
    this.#peer = peer;
  }

  send(data: Uint8Array): void {
    if (this.#closed) return;
    this.#peer?.deliver(data.slice());
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.#closed = true;
    this.#handlers.clear();
  }

  private deliver(data: Uint8Array): void {
    if (this.#closed) return;
    for (const handler of this.#handlers) handler(data.slice());
  }
}

function createTransportPair(): [MemoryTransport, MemoryTransport] {
  const left = new MemoryTransport();
  const right = new MemoryTransport();
  left.connect(right);
  right.connect(left);
  return [left, right];
}

function cloneProject(source: NoteProject): NoteProject {
  const documents = source.getAllDocuments().map((document) =>
    NoteDocument.fromSnapshot(document.id, document.exportSnapshot()),
  );
  return NoteProject.fromSnapshot(
    source.id,
    source.exportManifestSnapshot(),
    documents,
  );
}

describe("ProjectSyncEngine", () => {
  it("notifies after the complete initial remote full-state batch", () => {
    const source = NoteProject.create();
    source.createDocument("Remote note");
    const target = NoteProject.create(source.id);

    const [sourceTransport, targetTransport] = createTransportPair();
    let targetInitialStateReceived = false;

    const sourceEngine = new ProjectSyncEngine(source, sourceTransport);
    const targetEngine = new ProjectSyncEngine(target, targetTransport, {
      onInitialRemoteStateReceived: () => {
        targetInitialStateReceived = true;
        expect(target.listDocuments().map(({ title }) => title)).toContain(
          "Remote note",
        );
      },
    });

    sourceEngine.start();
    targetEngine.start();

    expect(targetInitialStateReceived).toBe(true);

    sourceEngine.stop();
    targetEngine.stop();
  });

  it("converges projects after independent offline edits", () => {
    const base = NoteProject.create();
    const baseDocument = base.createDocument("Base");

    const left = cloneProject(base);
    const right = cloneProject(base);

    left.renameDocument(baseDocument.id, "Renamed on left");
    right.renameDocument(baseDocument.id, "Renamed on right");
    left.createDocument("Left only");
    right.createDocument("Right only");

    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new ProjectSyncEngine(left, leftTransport);
    const rightEngine = new ProjectSyncEngine(right, rightTransport);

    leftEngine.start();
    rightEngine.start();

    const leftSummaries = left
      .listDocuments()
      .map(({ id, title }) => ({ id, title }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const rightSummaries = right
      .listDocuments()
      .map(({ id, title }) => ({ id, title }))
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(rightSummaries).toEqual(leftSummaries);
    expect(leftSummaries.map(({ title }) => title)).toContain("Left only");
    expect(leftSummaries.map(({ title }) => title)).toContain("Right only");
    expect(left.getDocument(baseDocument.id)?.title).toBe(
      right.getDocument(baseDocument.id)?.title,
    );

    leftEngine.stop();
    rightEngine.stop();
  });
});
