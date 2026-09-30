/** @vitest-environment jsdom */

import { NoteProject } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteProperties } from "../src/NoteProperties.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; node: HTMLDivElement }> = [];
afterEach(() => {
  for (const { root, node } of mounted) {
    act(() => root.unmount());
    node.remove();
  }
  mounted.length = 0;
});

describe("tag rename popover", () => {
  it("requires confirmation before merging an existing Project tag", () => {
    const workspace = NoteProject.create();
    const projectId = workspace.listProjects()[0]!.id;
    const note = workspace.createDocument("Tagged", projectId);
    note.setTags(["research", "papers"]);
    const onTagRename = vi.fn((oldTag: string, newTag: string) => workspace.renameTag(projectId, oldTag, newTag));
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    mounted.push({ root, node });
    act(() => root.render(createElement(NoteProperties, {
      document: note, availableTags: workspace.listProjectTags(projectId), onTagRename,
    })));

    const input = node.querySelector<HTMLInputElement>('input[aria-label="Rename research"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "papers");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => node.querySelector<HTMLButtonElement>(".tag-rename-row button")!.click());
    expect(onTagRename).not.toHaveBeenCalled();
    expect(node.textContent).toContain("Renaming will merge these tags");
    act(() => node.querySelector<HTMLButtonElement>(".tag-rename-confirmation button:last-child")!.click());
    expect(onTagRename).toHaveBeenCalledWith("research", "papers");
    expect(note.tags).toEqual(["papers"]);
  });
});
