import { describe, expect, test } from "vitest";

import { selectE2e } from "./select-e2e.mjs";

const change = (filename, status = "modified") => ({ filename, status });
const smoke = "e2e/smoke.spec.ts";

// These are changed-file API inputs, not inferred source dependency graphs.
describe("selectE2e", () => {
  test("skips documentation-only changes", () => {
    expect(selectE2e([[change("docs/architecture.md")]])).toEqual({
      verifyRequired: false,
      mode: "none",
      specs: [],
    });
  });

  test("selects smoke and an explicitly mapped editor file", () => {
    expect(selectE2e([[change("apps/web/src/editor-indentation.ts")]])).toEqual({
      verifyRequired: true,
      mode: "selected",
      specs: [smoke, "e2e/editor-indentation.spec.ts"],
    });
  });

  test("combines mapped groups across multiple API pages without duplicates", () => {
    expect(selectE2e([
      [change("apps/web/src/ProjectSettingsView.tsx")],
      [change("apps/web/src/SidebarNavigationToolbar.tsx")],
    ])).toEqual({
      verifyRequired: true,
      mode: "selected",
      specs: [smoke, "e2e/project-ui.spec.ts", "e2e/settings-scopes.spec.ts", "e2e/navigation.spec.ts", "e2e/mobile-sidebar.spec.ts"],
    });
  });

  test.each(["modified", "added"])("selects %s spec and smoke", (status) => {
    expect(selectE2e([[change("e2e/new-feature.spec.ts", status)]])).toEqual({
      verifyRequired: true,
      mode: "selected",
      specs: [smoke, "e2e/new-feature.spec.ts"],
    });
  });

  test.each(["removed", "renamed"])("runs full E2E for a %s spec", (status) => {
    expect(selectE2e([[change("e2e/editor-search.spec.ts", status)]])).toEqual({
      verifyRequired: true,
      mode: "all",
      specs: [],
    });
  });

  test.each([
    "e2e/fixtures.ts",
    "playwright.config.ts",
    ".github/workflows/ci.yml",
    "apps/web/src/NoteWorkspace.tsx",
    "apps/web/src/WorkspaceSettingsView.tsx",
    "apps/web/src/NewComponent.tsx",
    "apps/coordinator/src/index.ts",
    "packages/document/src/document.ts",
    "pnpm-lock.yaml",
  ])("runs full E2E for an unclassified runtime path (%s)", (filename) => {
    expect(selectE2e([[change(filename)]])).toEqual({
      verifyRequired: true,
      mode: "all",
      specs: [],
    });
  });

  test("does not let a doc change mask a runtime change", () => {
    expect(selectE2e([[change("docs/readme.md"), change("apps/web/src/App.tsx")]])).toEqual({
      verifyRequired: true,
      mode: "all",
      specs: [],
    });
  });

  test("treats any rename conservatively", () => {
    expect(selectE2e([[{ ...change("docs/readme.md", "renamed"), previous_filename: "apps/web/src/App.tsx" }]])).toEqual({
      verifyRequired: true,
      mode: "all",
      specs: [],
    });
  });

  test("fails on invalid, missing, or empty GitHub API data", () => {
    expect(() => selectE2e([])).toThrow();
    expect(() => selectE2e([[]])).toThrow();
    expect(() => selectE2e({})).toThrow();
    expect(() => selectE2e([[{ filename: "e2e/new.spec.ts" }]])).toThrow();
  });
});
