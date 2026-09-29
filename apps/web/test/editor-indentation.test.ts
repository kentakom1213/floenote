/** @vitest-environment jsdom */

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { floeMarkdownIndentation } from "../src/editor-indentation.js";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("Markdown editor indentation", () => {
  it("uses ordinary CodeMirror indentation for a normal line", () => {
    view = createEditor("plain text", 5);

    const event = pressTab(view);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("  plain text");
    expect(view.state.selection.main.head).toBe(7);
  });

  it("uses ordinary CodeMirror dedentation for a normal line", () => {
    view = createEditor("  plain text", 7);

    const event = pressTab(view, true);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("plain text");
    expect(view.state.selection.main.head).toBe(5);
  });

  it("nests and unnests an unordered list item by one list level", () => {
    view = createEditor("- parent\n- child", "- parent\n- child".length);

    expect(pressTab(view).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n  - child");

    expect(pressTab(view, true).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n- child");
  });

  it("nests and unnests a TODO list item by one list level", () => {
    view = createEditor(
      "- [ ] parent\n- [ ] child",
      "- [ ] parent\n- [ ] child".length,
    );

    pressTab(view);
    expect(view.state.doc.toString()).toBe("- [ ] parent\n  - [ ] child");

    pressTab(view, true);
    expect(view.state.doc.toString()).toBe("- [ ] parent\n- [ ] child");
  });

  it("uses the ordered-list marker width for single-digit nesting", () => {
    view = createEditor(
      "1. parent\n2. child",
      "1. parent\n2. child".length,
    );

    pressTab(view);
    expect(view.state.doc.toString()).toBe("1. parent\n   2. child");

    pressTab(view, true);
    expect(view.state.doc.toString()).toBe("1. parent\n2. child");
  });

  it("uses the actual multi-digit ordered-list marker width", () => {
    view = createEditor(
      "10. parent\n11. child",
      "10. parent\n11. child".length,
    );

    pressTab(view);
    expect(view.state.doc.toString()).toBe("10. parent\n    11. child");

    pressTab(view, true);
    expect(view.state.doc.toString()).toBe("10. parent\n11. child");
  });

  it("keeps ordinary indentation inside fenced code blocks", () => {
    const source = "```text\ncode\n```";
    const cursor = source.indexOf("code") + "code".length;
    view = createEditor(source, cursor);

    pressTab(view);

    expect(view.state.doc.toString()).toBe("```text\n  code\n```");
  });

  it("does not mutate a read-only editor", () => {
    view = createEditor("plain text", 5, true);

    pressTab(view);

    expect(view.state.doc.toString()).toBe("plain text");
  });
});

function createEditor(
  doc: string,
  anchor: number,
  readOnly = false,
): EditorView {
  const host = document.createElement("div");
  document.body.append(host);

  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown(),
      floeMarkdownIndentation,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ],
  });

  return new EditorView({ state, parent: host });
}

function pressTab(editor: EditorView, shiftKey = false): KeyboardEvent {
  editor.focus();
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  editor.contentDOM.dispatchEvent(event);
  return event;
}
