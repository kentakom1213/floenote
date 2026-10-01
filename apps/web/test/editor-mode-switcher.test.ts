/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorModeSwitcher } from "../src/NoteWorkspace.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("EditorModeSwitcher", () => {
  it("renders all modes with the active aria state", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(EditorModeSwitcher, {
            mode: "split",
            onModeChange: vi.fn(),
          }),
        );
      });

      const group = container.querySelector(".editor-mode-switch");
      const buttons = Array.from(container.querySelectorAll("button"));

      expect(group?.getAttribute("aria-label")).toBe("Note view");
      expect(buttons.map((button) => button.textContent)).toEqual([
        "Edit",
        "Split",
        "Preview",
        "Live",
      ]);
      expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
        "false",
        "true",
        "false",
        "false",
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("reports the selected mode without owning preference state", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onModeChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(EditorModeSwitcher, {
            mode: "edit",
            onModeChange,
          }),
        );
      });

      const preview = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Preview",
      );

      await act(async () => {
        preview?.click();
      });

      expect(onModeChange).toHaveBeenCalledTimes(1);
      expect(onModeChange).toHaveBeenCalledWith("preview");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
