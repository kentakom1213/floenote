/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "../src/Modal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let opener: HTMLButtonElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  opener?.remove();
  root = null;
  container = null;
  opener = null;
});

describe("Modal focus restoration", () => {
  it("restores focus to the previously focused element by default", () => {
    renderModal();
    focusModalInput();

    act(() => {
      root?.unmount();
      root = null;
    });

    expect(document.activeElement).toBe(opener);
  });

  it("can skip focus restoration when the modal completes navigation", () => {
    renderModal(() => false);
    focusModalInput();

    act(() => {
      root?.unmount();
      root = null;
    });

    expect(document.activeElement).not.toBe(opener);
  });
});

function renderModal(shouldRestoreFocus?: () => boolean): void {
  opener = document.createElement("button");
  opener.textContent = "Open";
  document.body.append(opener);
  opener.focus();

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      createElement(
        Modal,
        {
          labelledBy: "modal-title",
          onClose: vi.fn(),
          shouldRestoreFocus,
        },
        createElement("h2", { id: "modal-title" }, "Modal"),
        createElement("input", { "aria-label": "Modal input" }),
      ),
    );
  });
}

function focusModalInput(): void {
  const input = container?.querySelector<HTMLInputElement>(
    'input[aria-label="Modal input"]',
  );
  expect(input).not.toBeNull();
  input?.focus();
}
