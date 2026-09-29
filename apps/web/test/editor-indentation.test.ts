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
  it("indents a normal line with Tab and keeps the key in the editor", () => {
    view = createEditor("plain text", 5);

    const event = pressTab(view);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("   plain text");
    expect(view.state.selection.main.head).toBe(8);
  });

  it("dedents a normal indented line with Shift+Tab", () => {
    view = createEditor("   plain text", 8);

    const event = pressTab(view, true);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("plain text");
    expect(view.state.selection.main.head).toBe(5);
  });

  it("indents and dedents an unordered list item", () => {
    view = createEditor("- parent\n- item", "- parent\n- item".length);

    expect(pressTab(view).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n   - item");

    expect(pressTab(view, true).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n- item");
  });

  it("indents and dedents a TODO list item", () => {
    view = createEditor("- parent\n- [ ] task", "- parent\n- [ ] task".length);

    pressTab(view);
    expect(view.state.doc.toString()).toBe("- parent\n   - [ ] task");

    pressTab(view, true);
    expect(view.state.doc.toString()).toBe("- parent\n- [ ] task");
  });

  it("indents and dedents a numbered list item", () => {
    view = createEditor(
      "1. parent\n2. numbered",
      "1. parent\n2. numbered".length,
    );

    pressTab(view);
    expect(view.state.doc.toString()).toBe("1. parent\n   2. numbered");

    pressTab(view, true);
    expect(view.state.doc.toString()).toBe("1. parent\n2. numbered");
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
