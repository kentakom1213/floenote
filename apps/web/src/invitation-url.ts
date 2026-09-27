import type { WorkspaceId } from "@floe-note/domain";

const INVITATION_PATH_PATTERN = /^\/join\/v1\/[0-9a-f]{32}$/iu;
const INVALID_INVITATION_MESSAGE = "Paste a valid Floe Note invitation link.";

export function parseInvitationUrl(
  value: string,
  appOrigin: string,
): URL {
  let url: URL;

  try {
    url = new URL(value.trim(), appOrigin);
  } catch {
    throw new Error(INVALID_INVITATION_MESSAGE);
  }

  const hasPairingSecret = new URLSearchParams(url.hash.slice(1)).has("s");
  if (
    url.origin !== appOrigin ||
    !INVITATION_PATH_PATTERN.test(url.pathname) ||
    !hasPairingSecret
  ) {
    throw new Error(INVALID_INVITATION_MESSAGE);
  }

  return url;
}

export function replaceInvitationUrlWithProject(
  history: Pick<History, "replaceState">,
  projectId: WorkspaceId,
): void {
  history.replaceState(null, "", `/p/${projectId}`);
}
