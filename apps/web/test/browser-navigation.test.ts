/** @vitest-environment jsdom */

import { NoteProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useBrowserNavigation,
  type BrowserNavigation,
} from "../src/browser-navigation.js";
import { buildDocumentUrl } from "../src/browser-route.js";
import { resolveRootRoute } from "../src/root-route.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "0199a000-0000-7000-8000-000000000001";
const DOCUMENT_A = "0199a000-0000-7000-8000-000000000002";
const DOCUMENT_B = "0199a000-0000-7000-8000-000000000003";

let currentNavigation: BrowserNavigation | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function NavigationProbe() {
  const navigation = useBrowserNavigation();
  currentNavigation = navigation;

  return createElement(
    "output",
    {
      "data-route-kind": navigation.route.kind,
      "data-route-error": String(navigation.routeError),
    },
    navigation.route.kind,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(createElement(NavigationProbe));
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  currentNavigation = null;
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("browser navigation state", () => {
  it("updates URL and route state directly on application push without emitting popstate", () => {
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate);

    act(() => {
      currentNavigation?.pushRoute(
        `/p/${PROJECT_ID}/${DOCUMENT_A}`,
      );
    });

    expect(window.location.pathname).toBe(
      `/p/${PROJECT_ID}/${DOCUMENT_A}`,
    );
    expect(container?.textContent).toBe("document");
    expect(popstate).not.toHaveBeenCalled();

    window.removeEventListener("popstate", popstate);
  });

  it("replaces the current URL and route state without emitting popstate", () => {
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate);

    act(() => {
      currentNavigation?.replaceRoute(
        `/p/${PROJECT_ID}/${DOCUMENT_B}`,
      );
    });

    expect(window.location.pathname).toBe(
      `/p/${PROJECT_ID}/${DOCUMENT_B}`,
    );
    expect(container?.textContent).toBe("document");
    expect(popstate).not.toHaveBeenCalled();

    window.removeEventListener("popstate", popstate);
  });

  it("restores route state from a browser popstate without adding history", () => {
    act(() => {
      currentNavigation?.pushRoute(
        `/p/${PROJECT_ID}/${DOCUMENT_A}`,
      );
      currentNavigation?.pushRoute(
        `/p/${PROJECT_ID}/${DOCUMENT_B}`,
      );
    });

    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");

    act(() => {
      window.history.replaceState(
        null,
        "",
        `/p/${PROJECT_ID}/${DOCUMENT_A}`,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(container?.textContent).toBe("document");
    expect(window.location.pathname).toBe(
      `/p/${PROJECT_ID}/${DOCUMENT_A}`,
    );
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledOnce();
  });

  it("recovers from a 404 through root to the active local Project and canonical note URL", () => {
    const project = NoteProject.create(PROJECT_ID as ProjectId);
    const document = project.createDocument("Recovered note");
    const summaries = [
      {
        id: project.id,
        name: project.name,
        createdAt: 1,
        isActive: true,
      },
    ];

    act(() => {
      currentNavigation?.setRouteError(true);
    });
    expect(
      container?.querySelector("output")?.getAttribute("data-route-error"),
    ).toBe("true");

    act(() => {
      currentNavigation?.pushRoute("/");
    });

    expect(container?.textContent).toBe("root");
    expect(
      container?.querySelector("output")?.getAttribute("data-route-error"),
    ).toBe("false");

    const openResolution = resolveRootRoute(null, summaries, null);
    expect(openResolution).toEqual({
      kind: "open-project",
      projectId: project.id,
    });

    const canonicalResolution = resolveRootRoute(
      project,
      summaries,
      document.id,
    );
    expect(canonicalResolution).toEqual({
      kind: "canonical-project",
      projectId: project.id,
      documentId: document.id,
    });

    if (canonicalResolution.kind !== "canonical-project") {
      throw new Error("Expected canonical Project resolution");
    }

    act(() => {
      currentNavigation?.replaceRoute(
        canonicalResolution.documentId
          ? buildDocumentUrl(
              canonicalResolution.projectId,
              canonicalResolution.documentId,
            )
          : `/p/${canonicalResolution.projectId}`,
      );
    });

    expect(window.location.pathname).toBe(
      buildDocumentUrl(project.id, document.id),
    );
    expect(container?.textContent).toBe("document");
  });

  it("clears stale application 404 state on application and browser navigation", () => {
    act(() => {
      currentNavigation?.setRouteError(true);
    });
    expect(
      container?.querySelector("output")?.getAttribute("data-route-error"),
    ).toBe("true");

    act(() => {
      currentNavigation?.pushRoute(`/p/${PROJECT_ID}`);
    });
    expect(
      container?.querySelector("output")?.getAttribute("data-route-error"),
    ).toBe("false");

    act(() => {
      currentNavigation?.setRouteError(true);
      window.history.replaceState(null, "", "/settings");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(container?.textContent).toBe("device-settings");
    expect(
      container?.querySelector("output")?.getAttribute("data-route-error"),
    ).toBe("false");
  });
});
