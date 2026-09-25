/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useBrowserNavigation,
  type BrowserNavigation,
} from "../src/browser-navigation.js";

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
