/** @vitest-environment jsdom */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NoteProject } from "@floe-note/document";
import { createDeviceId } from "@floe-note/domain";

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
        getDeviceName: () => null,
      }),
    );

    expect(markup).toContain("History");
    expect(markup).toContain("Current");
    expect(markup).toContain("edit-history-item selected");
  });

  it("shows the device that created a recovery version", () => {
    const project = NoteProject.create();
    const note = project.createDocument("History");
    const deviceId = createDeviceId();
    const checkpoint = project.createEditHistoryCheckpoint(note.id, {
      createdAt: Date.UTC(2026, 8, 25, 12, 34),
      createdByDeviceId: deviceId,
    });
    expect(checkpoint).not.toBeNull();

    const listMarkup = renderToStaticMarkup(
      createElement(EditHistoryPanel, {
        checkpoints: project.listEditHistoryCheckpoints(note.id),
        selectedCheckpointId: checkpoint?.id ?? null,
        onSelectCheckpoint: vi.fn(),
        onSelectCurrent: vi.fn(),
        onClose: vi.fn(),
        getDeviceName: () => "Ubuntu",
      }),
    );

    expect(listMarkup).toContain("Ubuntu");
    expect(listMarkup).toContain("Created on Ubuntu");
    expect(listMarkup).toContain("history-device-dot");

    const historical = checkpoint
      ? project.createHistoricalDocument(checkpoint.id)
      : null;
    expect(historical).not.toBeNull();

    const previewMarkup = renderToStaticMarkup(
      createElement(HistoricalVersionView, {
        checkpoint: checkpoint!,
        document: historical!,
        currentDocument: note,
        createdByDeviceName: "Ubuntu",
        onBackToCurrent: vi.fn(),
        onRestore: vi.fn(),
      }),
    );

    expect(previewMarkup).toContain("Created on ");
    expect(previewMarkup).toContain("Ubuntu");
    expect(previewMarkup).toContain("compared with current");
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
        currentDocument: note,
        createdByDeviceName: null,
        onBackToCurrent: vi.fn(),
        onRestore: vi.fn(),
      }),
    );

    expect(markup).toContain("Compared with current");
    expect(markup).toContain("Historical");
    expect(markup).toContain("old");
    expect(markup).toContain("Restore this version");
    expect(markup).toContain("Your current state remains");
  });

  it("shows body changes since the selected checkpoint", () => {
    const project = NoteProject.create();
    const note = project.createDocumentWithInitialState({
      title: "Diff",
      body: "alpha\n- beta old",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });
    const checkpoint = project.createEditHistoryCheckpoint(note.id, {
      createdAt: 200,
    });
    expect(checkpoint).not.toBeNull();

    note.getEditorBinding().getText(note.getEditorBinding().doc).update(
      "alpha\n- beta new",
    );
    note.getEditorBinding().doc.commit();

    const historical = checkpoint
      ? project.createHistoricalDocument(checkpoint.id)
      : null;
    expect(historical).not.toBeNull();

    const markup = renderToStaticMarkup(
      createElement(HistoricalVersionView, {
        checkpoint: checkpoint!,
        document: historical!,
        currentDocument: note,
        createdByDeviceName: null,
        onBackToCurrent: vi.fn(),
        onRestore: vi.fn(),
      }),
    );

    expect(markup).toContain("historical-inline-diff");
    expect(markup).toContain("historical-diff-removed");
    expect(markup).toContain("historical-diff-added");
    expect(markup).toContain(">beta old</del>");
    expect(markup).toContain(">beta new</mark>");
    expect(markup).toContain("<li");
  });
});
