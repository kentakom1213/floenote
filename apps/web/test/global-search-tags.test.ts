/** @vitest-environment jsdom */

import { NoteProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobalSearch } from "../src/GlobalSearch.js";
import { GlobalSearchCache } from "../src/global-search.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("GlobalSearch tag rendering", () => {
  it("shows distinct Project labels for equal names in Recent Notes", () => {
    const workspace = NoteProject.create();
    const first = workspace.listProjects()[0]!.id;
    workspace.renameWorkspaceProject(first, "Research");
    const second = workspace.createProject("Research").id;
    workspace.createDocument("Same title", first);
    workspace.createDocument("Same title", second);
    const cache = new GlobalSearchCache();
    cache.syncProject(workspace);
    container = documentNode();
    root = createRoot(container);
    act(() => root?.render(createElement(GlobalSearch, {
      cache, lastOpenedAt: new Map(),
      getTagColor: (projectId, tag) => workspace.resolveTagColor(projectId, tag),
      onClose: vi.fn(), onSelect: vi.fn(),
    })));
    const labels = [...container.querySelectorAll(".global-search-result-project")]
      .map((element) => element.textContent);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(labels.every((label) => label?.startsWith("Research · "))).toBe(true);
  });

  it("uses the shared Project-colored TagChip for matched tags", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Tagged note",
      body: "",
      createdAt: 100,
      updatedAt: 100,
      tags: ["research"],
    });
    project.setTagColor(project.listProjects()[0]!.id, "research", "blue");
    const otherProjectId = project.createProject("Other").id;
    project.createDocumentWithInitialState({
      title: "Another tagged note", body: "", createdAt: 100, updatedAt: 100,
      tags: ["research"],
    }, otherProjectId);
    project.setTagColor(otherProjectId, "research", "orange");

    const cache = new GlobalSearchCache();
    cache.syncProject(project);

    container = documentNode();
    root = createRoot(container);

    act(() => {
      root?.render(
        createElement(GlobalSearch, {
          cache,
          lastOpenedAt: new Map(),
          getTagColor: (projectId: ProjectId, tag: string) => project.resolveTagColor(projectId, tag),
          onClose: vi.fn(),
          onSelect: vi.fn(),
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search all notes"]',
    );
    expect(input).not.toBeNull();

    act(() => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "research");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const chip = container.querySelector(
      '.global-search-result-tags .tag-chip[data-tag-color="blue"]',
    );
    expect(chip?.textContent).toBe("research");
    expect(container.querySelector('.global-search-result-tags .tag-chip[data-tag-color="orange"]')?.textContent).toBe("research");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).toContain("Other");
    expect(container.textContent).toContain(document.title);
  });
});

function documentNode(): HTMLDivElement {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}
