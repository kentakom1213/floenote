/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_PREFERENCE,
  applyEditorPreference,
  clearEditorPreference,
  normalizeEditorPreference,
  readEditorPreference,
  writeEditorPreference,
  type EditorPreference,
} from "../src/editor-preference.js";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("editor preference", () => {
  it("uses the current editor appearance as its defaults", () => {
    expect(readEditorPreference()).toEqual(DEFAULT_EDITOR_PREFERENCE);
    expect(DEFAULT_EDITOR_PREFERENCE).toEqual({
      textSize: "default",
      lineHeight: "default",
      contentWidth: "default",
    });
  });

  it("reads valid persisted values", () => {
    window.localStorage.setItem(
      "floe-note-editor-preference",
      JSON.stringify({
        textSize: "large",
        lineHeight: "relaxed",
        contentWidth: "wide",
      }),
    );

    expect(readEditorPreference()).toEqual({
      textSize: "large",
      lineHeight: "relaxed",
      contentWidth: "wide",
    });
  });

  it("falls back per field for invalid, partial, and stale values", () => {
    expect(
      normalizeEditorPreference({
        textSize: "huge",
        lineHeight: "compact",
        legacyWidth: 900,
      }),
    ).toEqual({
      textSize: "default",
      lineHeight: "compact",
      contentWidth: "default",
    });

    window.localStorage.setItem(
      "floe-note-editor-preference",
      JSON.stringify({
        textSize: "small",
        lineHeight: 1.8,
        contentWidth: "obsolete",
      }),
    );

    expect(readEditorPreference()).toEqual({
      textSize: "small",
      lineHeight: "default",
      contentWidth: "default",
    });

    window.localStorage.setItem("floe-note-editor-preference", "{broken");
    expect(readEditorPreference()).toEqual(DEFAULT_EDITOR_PREFERENCE);
  });

  it("round-trips a valid preference", () => {
    const preference: EditorPreference = {
      textSize: "extra-large",
      lineHeight: "compact",
      contentWidth: "narrow",
    };

    writeEditorPreference(preference);
    expect(readEditorPreference()).toEqual(preference);
  });

  it("clears persisted and applied editor preferences", () => {
    const preference: EditorPreference = {
      textSize: "large",
      lineHeight: "relaxed",
      contentWidth: "wide",
    };

    writeEditorPreference(preference);
    applyEditorPreference(preference);
    document.documentElement.dataset.theme = "charcoal";

    clearEditorPreference();

    expect(readEditorPreference()).toEqual(DEFAULT_EDITOR_PREFERENCE);
    expect(
      document.documentElement.style.getPropertyValue("--editor-font-size"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--editor-line-height"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--editor-content-width"),
    ).toBe("");
    expect(document.documentElement.dataset.theme).toBe("charcoal");
  });

  it("applies typography through root CSS variables without changing theme", () => {
    document.documentElement.dataset.theme = "charcoal";

    applyEditorPreference({
      textSize: "extra-large",
      lineHeight: "relaxed",
      contentWidth: "wide",
    });

    expect(
      document.documentElement.style.getPropertyValue("--editor-font-size"),
    ).toBe("20px");
    expect(
      document.documentElement.style.getPropertyValue("--editor-line-height"),
    ).toBe("1.8");
    expect(
      document.documentElement.style.getPropertyValue("--editor-content-width"),
    ).toBe("1000px");
    expect(document.documentElement.dataset.theme).toBe("charcoal");
  });
});
