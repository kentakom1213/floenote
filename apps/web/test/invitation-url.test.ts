/** @vitest-environment jsdom */

import { parseWorkspaceId } from "@floe-note/domain";
import { describe, expect, it } from "vitest";

import {
  parseInvitationUrl,
  replaceInvitationUrlWithWorkspace,
} from "../src/invitation-url.js";

const ORIGIN = "https://floe.pwll.dev";
const INVITE_ID = "0123456789abcdef0123456789abcdef";
const WORKSPACE_ID = parseWorkspaceId("00000000-0000-7000-8000-000000000010");

describe("parseInvitationUrl", () => {
  it("accepts an invitation URL on the app origin", () => {
    const url = parseInvitationUrl(
      `${ORIGIN}/join/v1/${INVITE_ID}#s=pairing-secret`,
      ORIGIN,
    );
    expect(url.pathname).toBe(`/join/v1/${INVITE_ID}`);
    expect(url.hash).toBe("#s=pairing-secret");
  });

  it("accepts a relative invitation URL", () => {
    const url = parseInvitationUrl(
      `/join/v1/${INVITE_ID}#s=pairing-secret`,
      ORIGIN,
    );
    expect(url.origin).toBe(ORIGIN);
  });

  it("preserves the existing fragment validation semantics", () => {
    expect(() =>
      parseInvitationUrl(`/join/v1/${INVITE_ID}#s=`, ORIGIN),
    ).not.toThrow();
  });

  it.each([
    `https://example.com/join/v1/${INVITE_ID}#s=pairing-secret`,
    `/join/v2/${INVITE_ID}#s=pairing-secret`,
    "/join/v1/not-an-invite#s=pairing-secret",
    `/join/v1/${INVITE_ID}`,
  ])("rejects invalid invitation links: %s", (value) => {
    expect(() => parseInvitationUrl(value, ORIGIN)).toThrow(
      "Paste a valid Floe Note invitation link.",
    );
  });
});

describe("replaceInvitationUrlWithWorkspace", () => {
  it("replaces the current invitation entry without preserving the secret", () => {
    const calls: unknown[][] = [];
    const history = {
      replaceState: (...args: unknown[]) => calls.push(args),
    } as unknown as Pick<History, "replaceState">;

    replaceInvitationUrlWithWorkspace(history, WORKSPACE_ID);

    expect(calls).toEqual([[null, "", `/w/${WORKSPACE_ID}`]]);
    expect(JSON.stringify(calls)).not.toContain("pairing-secret");
  });

  it("replaces the invitation history entry and removes its fragment", () => {
    window.history.replaceState(
      null,
      "",
      `/join/v1/${INVITE_ID}#s=pairing-secret`,
    );

    replaceInvitationUrlWithWorkspace(window.history, WORKSPACE_ID);

    expect(window.location.pathname).toBe(`/w/${WORKSPACE_ID}`);
    expect(window.location.hash).toBe("");
    expect(window.history.state).toBeNull();
  });
});
