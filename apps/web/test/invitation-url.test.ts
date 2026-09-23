import { describe, expect, it } from "vitest";

import { parseInvitationUrl } from "../src/invitation-url.js";

const ORIGIN = "https://floe.pwll.dev";
const INVITE_ID = "0123456789abcdef0123456789abcdef";

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
