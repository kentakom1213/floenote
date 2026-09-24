import { createDocumentId } from "@floe-note/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteDocument, type TaskMarkerToggle } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NoteDocument task marker mutation", () => {
  it("toggles unchecked, checked, and uppercase checked markers canonically", () => {
    const document = noteWithBody("- [ ] one\n- [x] two\n- [X] three");

    expect(document.toggleTaskMarker(taskAt(document.bodyText, "[ ]", true))).toBe(
      true,
    );
    expect(document.bodyText).toBe("- [x] one\n- [x] two\n- [X] three");

    expect(
      document.toggleTaskMarker(
        taskAt(document.bodyText, "[x]", false, document.bodyText.indexOf("two")),
      ),
    ).toBe(true);
    expect(document.bodyText).toBe("- [x] one\n- [ ] two\n- [X] three");

    expect(
      document.toggleTaskMarker(
        taskAt(document.bodyText, "[X]", false, document.bodyText.indexOf("three")),
      ),
    ).toBe(true);
    expect(document.bodyText).toBe("- [x] one\n- [ ] two\n- [ ] three");

    expect(
      document.toggleTaskMarker(
        taskAt(document.bodyText, "[ ]", true, document.bodyText.indexOf("three")),
      ),
    ).toBe(true);
    expect(document.bodyText).toBe("- [x] one\n- [ ] two\n- [x] three");
  });

  it("uses JavaScript UTF-16 offsets safely when emoji precede the task", () => {
    const body = "😀 heading\n- [ ] 日本語 task";
    const document = noteWithBody(body);
    const sourceStart = body.indexOf("[ ]");

    expect(sourceStart).toBeGreaterThan("😀".length);
    expect(
      document.toggleTaskMarker(taskAt(body, "[ ]", true, sourceStart)),
    ).toBe(true);
    expect(document.bodyText).toBe("😀 heading\n- [x] 日本語 task");
  });

  it("refuses a stale source mapping instead of changing another task", () => {
    const original = "- [ ] first\n- [ ] second";
    const document = noteWithBody(original);
    const stale = taskAt(original, "[ ]", true, original.indexOf("[ ]", 5));
    const binding = document.getEditorBinding();

    binding.getText(binding.doc).insert(0, "new line\n");
    binding.doc.commit();

    const beforeToggle = document.bodyText;
    expect(document.toggleTaskMarker(stale)).toBe(false);
    expect(document.bodyText).toBe(beforeToggle);
    expect(document.bodyText).toContain("- [ ] second");
  });

  it("emits an ordinary local body update and advances updatedAt", async () => {
    const document = NoteDocument.createWithInitialState(createDocumentId(), {
      title: "Tasks",
      body: "- [ ] sync me",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });
    const replica = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    const updates: Uint8Array[] = [];
    document.subscribeLocalUpdates((update) => updates.push(update));
    vi.spyOn(Date, "now").mockReturnValue(500);

    expect(
      document.toggleTaskMarker(taskAt(document.bodyText, "[ ]", true)),
    ).toBe(true);
    await Promise.resolve();

    expect(document.bodyText).toBe("- [x] sync me");
    expect(document.updatedAt).toBe(500);
    expect(updates.length).toBeGreaterThanOrEqual(2);

    for (const update of updates) replica.importUpdate(update);
    expect(replica.bodyText).toBe("- [x] sync me");
    expect(replica.updatedAt).toBe(500);
  });
});

function noteWithBody(body: string): NoteDocument {
  return NoteDocument.createWithInitialState(createDocumentId(), {
    title: "Tasks",
    body,
    createdAt: 100,
    updatedAt: 100,
    tags: [],
  });
}

function taskAt(
  body: string,
  marker: "[ ]" | "[x]" | "[X]",
  checked: boolean,
  from = 0,
): TaskMarkerToggle {
  const sourceStart = body.indexOf(marker, from);
  if (sourceStart < 0) throw new Error(`Missing marker ${marker}`);

  const lineStart = body.lastIndexOf("\n", sourceStart - 1) + 1;
  const nextNewline = body.indexOf("\n", sourceStart);
  const lineEnd = nextNewline < 0 ? body.length : nextNewline;

  return {
    sourceStart,
    sourceEnd: sourceStart + marker.length,
    lineStart,
    lineEnd,
    sourceLine: body.slice(lineStart, lineEnd),
    sourceMarker: marker,
    checked,
  };
}
