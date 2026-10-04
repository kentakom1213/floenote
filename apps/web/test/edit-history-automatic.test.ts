/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoteDocument, NoteProject } from "@floe-note/document";
import { createDeviceId, type DeviceId } from "@floe-note/domain";

import {
  EDIT_HISTORY_CONTINUOUS_CHECKPOINT_MS,
  EDIT_HISTORY_IDLE_CHECKPOINT_MS,
  useAutomaticEditHistory,
} from "../src/useAutomaticEditHistory.js";

function Harness({
  project,
  document,
  deviceId = null,
}: {
  project: NoteProject;
  document: NoteDocument;
  deviceId?: DeviceId | null;
}) {
  useAutomaticEditHistory(project, document, deviceId);
  return null;
}

function editBody(document: NoteDocument, value: string): void {
  const binding = document.getEditorBinding();
  const text = binding.getText(binding.doc);
  const current = text.toString();
  text.splice(0, current.length, value);
  binding.doc.commit();
}

describe("automatic edit history checkpoints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("creates a checkpoint after two minutes of editing idle", async () => {
    const project = NoteProject.create();
    const note = project.createDocument("Idle");
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(createElement(Harness, { project, document: note }));
      });

      await act(async () => {
        editBody(note, "changed");
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(EDIT_HISTORY_IDLE_CHECKPOINT_MS - 1);
      });
      expect(project.listEditHistoryCheckpoints(note.id)).toEqual([]);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(project.listEditHistoryCheckpoints(note.id)).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("records the device that created an automatic recovery point", async () => {
    const project = NoteProject.create();
    const note = project.createDocument("Attributed");
    const deviceId = createDeviceId();
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(Harness, {
            project,
            document: note,
            deviceId,
          }),
        );
      });

      await act(async () => {
        editBody(note, "changed");
        await Promise.resolve();
        vi.advanceTimersByTime(EDIT_HISTORY_IDLE_CHECKPOINT_MS);
      });

      expect(
        project.listEditHistoryCheckpoints(note.id)[0]?.createdByDeviceId,
      ).toBe(deviceId);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("creates a checkpoint after ten minutes of continuous editing", async () => {
    const project = NoteProject.create();
    const note = project.createDocument("Continuous");
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(createElement(Harness, { project, document: note }));
      });

      await act(async () => {
        editBody(note, "0");
        await Promise.resolve();
      });

      for (let minute = 1; minute < 10; minute += 1) {
        await act(async () => {
          vi.advanceTimersByTime(60_000);
          editBody(note, String(minute));
          await Promise.resolve();
        });
      }

      expect(project.listEditHistoryCheckpoints(note.id)).toEqual([]);

      await act(async () => {
        vi.advanceTimersByTime(
          EDIT_HISTORY_CONTINUOUS_CHECKPOINT_MS - 9 * 60_000,
        );
      });

      expect(project.listEditHistoryCheckpoints(note.id)).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("creates a checkpoint when leaving a dirty note", async () => {
    const project = NoteProject.create();
    const note = project.createDocument("Leave");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness, { project, document: note }));
    });

    await act(async () => {
      editBody(note, "unsaved session history");
      await Promise.resolve();
    });

    expect(project.listEditHistoryCheckpoints(note.id)).toEqual([]);

    await act(async () => {
      root.unmount();
    });

    expect(project.listEditHistoryCheckpoints(note.id)).toHaveLength(1);
  });

  it("does not create checkpoints from remote document imports alone", async () => {
    const source = NoteProject.create();
    const sourceNote = source.createDocument("Remote");
    const targetNote = NoteDocument.fromSnapshot(
      sourceNote.id,
      sourceNote.exportSnapshot(),
    );
    const target = NoteProject.fromSnapshot(
      source.id,
      source.exportManifestSnapshot(),
      [targetNote],
    );
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(Harness, {
            project: target,
            document: targetNote,
          }),
        );
      });

      editBody(sourceNote, "remote change");
      await act(async () => {
        target.importDocumentUpdate(sourceNote.id, sourceNote.exportUpdate());
        await Promise.resolve();
        vi.advanceTimersByTime(EDIT_HISTORY_CONTINUOUS_CHECKPOINT_MS * 2);
      });

      expect(target.listEditHistoryCheckpoints(targetNote.id)).toEqual([]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
