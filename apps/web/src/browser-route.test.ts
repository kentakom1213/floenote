import { describe, expect, it } from "vitest";

import {
  buildDocumentUrl,
  buildProjectSettingsUrl,
  buildProjectUrl,
  buildTrashDocumentUrl,
  buildTrashUrl,
  parseLocation,
} from "./browser-route.js";

const PROJECT_ID = "0199a000-0000-7000-8000-000000000001";
const DOCUMENT_ID = "0199a000-0000-7000-8000-000000000002";

describe("browser routes", () => {
  it.each([
    ["/", "root"],
    ["/settings", "device-settings"],
    [`/p/${PROJECT_ID}`, "project"],
    [`/p/${PROJECT_ID}/${DOCUMENT_ID}`, "document"],
    [`/p/${PROJECT_ID}/settings`, "project-settings"],
    [`/p/${PROJECT_ID}/trash`, "trash"],
    [`/p/${PROJECT_ID}/trash/${DOCUMENT_ID}`, "trash-document"],
  ])("parses %s", (pathname, kind) => {
    expect(parseLocation({ pathname, hash: "" } as Location)).toMatchObject({ kind });
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
    "/p/not-a-uuid",
    `/p/${PROJECT_ID}/not-a-uuid`,
    `/p/${PROJECT_ID}/trash/not-a-uuid`,
    "/unknown",
  ])("maps malformed or unknown route %s to not-found", (pathname) => {
    expect(parseLocation({ pathname, hash: "" } as Location)).toEqual({
      kind: "not-found",
    });
  });

  it("builds canonical project and document URLs", () => {
    const projectId = PROJECT_ID as never;
    const documentId = DOCUMENT_ID as never;
    expect(buildProjectUrl(projectId)).toBe(`/p/${PROJECT_ID}`);
    expect(buildDocumentUrl(projectId, documentId)).toBe(
      `/p/${PROJECT_ID}/${DOCUMENT_ID}`,
    );
    expect(buildProjectSettingsUrl(projectId)).toBe(
      `/p/${PROJECT_ID}/settings`,
    );
    expect(buildTrashUrl(projectId)).toBe(`/p/${PROJECT_ID}/trash`);
    expect(buildTrashDocumentUrl(projectId, documentId)).toBe(
      `/p/${PROJECT_ID}/trash/${DOCUMENT_ID}`,
    );
  });
});
