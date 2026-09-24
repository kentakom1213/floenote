import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NoteProject } from "@floe-note/document";

import {
  EditHistoryPanel,
  HistoricalVersionView,
} from "../src/EditHistory.js";

describe("edit history UI", () => {
  it("renders Current and timestamped checkpoints", () => {
    const project = NoteProject.create();
    const note = project.createDocument("History");
    const checkpoint = project.createEditHistoryCheckpoint(note.id, {
      createdAt: Date.UTC(2026, 8, 25, 12, 34),
    });
    expect(checkpoint).not.toBeNull();

    const markup = renderToStaticMarkup(
      createElement(EditHistoryPanel, {
        checkpoints: project.listEditHistoryCheckpoints(note.id),
        selectedCheckpointId: checkpoint?.id ?? null,
        onSelectCheckpoint: vi.fn(),
        onSelectCurrent: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain("History");
    expect(markup).toContain("Current");
    expect(markup).toContain("edit-history-item selected");
  });

  it("explains restore semantics in historical preview", () => {
    const project = NoteProject.create();
    const note = project.createDocumentWithInitialState({
      title: "Historical",
      body: "old body",
      createdAt: 100,
      updatedAt: 100,
      tags: ["old"],
    });
    const checkpoint = project.createEditHistoryCheckpoint(note.id, {
      createdAt: 200,
    });
    expect(checkpoint).not.toBeNull();

    const historical = checkpoint
      ? project.createHistoricalDocument(checkpoint.id)
      : null;
    expect(historical).not.toBeNull();

    const markup = renderToStaticMarkup(
      createElement(HistoricalVersionView, {
        checkpoint: checkpoint!,
        document: historical!,
        onBackToCurrent: vi.fn(),
        onRestore: vi.fn(),
      }),
    );

    expect(markup).toContain("Read-only historical version");
    expect(markup).toContain("Historical");
    expect(markup).toContain("old");
    expect(markup).toContain("Restore this version");
    expect(markup).toContain("Your current state remains");
  });
});
