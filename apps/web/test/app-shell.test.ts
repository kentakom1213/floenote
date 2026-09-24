import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/AppShell.js";

describe("AppShell mobile navigation", () => {
  it("renders an accessible closed mobile navigation drawer without changing desktop preference semantics", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        sidebar: createElement("div", null, "Navigation"),
        mobileNavigationOpen: false,
        mobileTitle: "Research note",
        onMobileNavigationOpenChange: vi.fn(),
        children: createElement("div", null, "Editor"),
      }),
    );

    expect(markup).toContain('id="primary-navigation"');
    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain('data-mobile-open="false"');
    expect(markup).toContain('aria-label="Open navigation"');
    expect(markup).toContain('aria-controls="primary-navigation"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-sidebar-collapsed="false"');
    expect(markup).toContain("Research note");
  });

  it("exposes open drawer state independently from the persistent desktop sidebar state", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        sidebar: createElement("div", null, "Navigation"),
        mobileNavigationOpen: true,
        mobileTitle: "Trash",
        onMobileNavigationOpenChange: vi.fn(),
        children: createElement("div", null, "Trash preview"),
      }),
    );

    expect(markup).toContain('data-mobile-open="true"');
    expect(markup).toContain('data-open="true"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Close navigation"');
    expect(markup).toContain('data-sidebar-collapsed="false"');
  });
});
