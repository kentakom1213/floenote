import { describe, expect, it } from "vitest";

import {
  buildNoteUrl,
  buildTrashNoteUrl,
  buildTrashUrl,
  buildWorkspaceSettingsUrl,
  buildWorkspaceUrl,
  parseLocation,
} from "./browser-route.js";

const WORKSPACE_ID = "0199a000-0000-7000-8000-000000000001";
const NOTE_ID = "0199a000-0000-7000-8000-000000000002";

describe("browser routes", () => {
  it.each([
    ["/", "root"],
    ["/settings", "device-settings"],
    [`/w/${WORKSPACE_ID}`, "workspace"],
    [`/w/${WORKSPACE_ID}/n/${NOTE_ID}`, "note"],
    [`/w/${WORKSPACE_ID}/settings`, "workspace-settings"],
    [`/w/${WORKSPACE_ID}/trash`, "trash"],
    [`/w/${WORKSPACE_ID}/trash/${NOTE_ID}`, "trash-note"],
  ])("parses %s", (pathname, kind) => {
    expect(parseLocation({ pathname, hash: "" } as Location)).toMatchObject({
      kind,
    });
  });

  it("preserves Workspace and note identity in parsed canonical routes", () => {
    expect(
      parseLocation({
        pathname: `/w/${WORKSPACE_ID}/n/${NOTE_ID}`,
        hash: "",
      } as Location),
    ).toEqual({
      kind: "note",
      workspaceId: WORKSPACE_ID,
      noteId: NOTE_ID,
    });
  });

  it("parses invitation secrets only from the fragment", () => {
    expect(
      parseLocation({
        pathname: "/join/v1/0123456789abcdef0123456789abcdef",
        hash: "#s=pairing-secret",
      } as Location),
    ).toEqual({
      kind: "invitation",
      inviteId: "0123456789abcdef0123456789abcdef",
      pairingSecret: "pairing-secret",
    });
  });

  it.each([
    "/w/not-a-uuid",
    `/w/${WORKSPACE_ID}/n/not-a-uuid`,
    `/w/${WORKSPACE_ID}/trash/not-a-uuid`,
    `/w/${WORKSPACE_ID}/${NOTE_ID}`,
    `/p/${WORKSPACE_ID}`,
    `/p/${WORKSPACE_ID}/${NOTE_ID}`,
    "/unknown",
  ])("maps malformed or unknown route %s to not-found", (pathname) => {
    expect(parseLocation({ pathname, hash: "" } as Location)).toEqual({
      kind: "not-found",
    });
  });

  it("builds canonical Workspace and note URLs", () => {
    const workspaceId = WORKSPACE_ID as never;
    const noteId = NOTE_ID as never;
    expect(buildWorkspaceUrl(workspaceId)).toBe(`/w/${WORKSPACE_ID}`);
    expect(buildNoteUrl(workspaceId, noteId)).toBe(
      `/w/${WORKSPACE_ID}/n/${NOTE_ID}`,
    );
    expect(buildWorkspaceSettingsUrl(workspaceId)).toBe(
      `/w/${WORKSPACE_ID}/settings`,
    );
    expect(buildTrashUrl(workspaceId)).toBe(`/w/${WORKSPACE_ID}/trash`);
    expect(buildTrashNoteUrl(workspaceId, noteId)).toBe(
      `/w/${WORKSPACE_ID}/trash/${NOTE_ID}`,
    );
  });
});
