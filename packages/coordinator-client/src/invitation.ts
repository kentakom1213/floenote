import { parseProjectId, type ProjectId } from "@floe-note/domain";

import { parseSessionId, type SessionId } from "./session-id.js";

declare const inviteIdBrand: unique symbol;
declare const pairingSecretBrand: unique symbol;

export type InviteId = string & {
  readonly [inviteIdBrand]: "InviteId";
};

export type PairingSecret = string & {
  readonly [pairingSecretBrand]: "PairingSecret";
};

export type CreatedInvitation = {
  inviteId: InviteId;
  sessionId: SessionId;
  expiresAt: number;
};

export type ClaimedInvitation = {
  projectId: ProjectId;
  sessionId: SessionId;
  expiresAt: number;
};

const INVITE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const PAIRING_SECRET_PATTERN = /^[0-9a-f]{64}$/i;

export class InvitationClient {
  readonly #baseUrl: URL;

  constructor(coordinatorBaseUrl: string) {
    this.#baseUrl = new URL(coordinatorBaseUrl);
  }

  async createInvite(projectId: ProjectId): Promise<CreatedInvitation> {
    const response = await fetch(
      new URL(
        `/projects/${encodeURIComponent(projectId)}/invites`,
        this.#baseUrl,
      ),
      {
        method: "POST",
      },
    );
    await ensureOk(response);

    const payload = (await response.json()) as Record<string, unknown>;
    if (
      typeof payload.inviteId !== "string" ||
      typeof payload.sessionId !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      throw new Error("Coordinator returned an invalid invitation");
    }

    return {
      inviteId: parseInviteId(payload.inviteId),
      sessionId: parseSessionId(payload.sessionId),
      expiresAt: payload.expiresAt,
    };
  }

  async claimInvite(inviteId: InviteId): Promise<ClaimedInvitation> {
    const response = await this.#postInviteAction(inviteId, "claim");
    await ensureOk(response);

    const payload = (await response.json()) as Record<string, unknown>;
    if (
      typeof payload.projectId !== "string" ||
      typeof payload.sessionId !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      throw new Error("Coordinator returned an invalid claimed invitation");
    }

    return {
      projectId: parseProjectId(payload.projectId),
      sessionId: parseSessionId(payload.sessionId),
      expiresAt: payload.expiresAt,
    };
  }

  async consumeInvite(inviteId: InviteId): Promise<void> {
    const response = await this.#postInviteAction(inviteId, "consume");
    await ensureOk(response);
  }

  async cancelInvite(inviteId: InviteId): Promise<void> {
    const response = await this.#postInviteAction(inviteId, "cancel");
    await ensureOk(response);
  }

  #postInviteAction(
    inviteId: InviteId,
    action: "claim" | "consume" | "cancel",
  ): Promise<Response> {
    return fetch(
      new URL(
        `/invites/${encodeURIComponent(inviteId)}/${action}`,
        this.#baseUrl,
      ),
      {
        method: "POST",
      },
    );
  }
}

export function createPairingSecret(): PairingSecret {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  ) as PairingSecret;
}

export function parseInviteId(value: string): InviteId {
  if (!INVITE_ID_PATTERN.test(value)) {
    throw new TypeError("InviteId must be a 128-bit hexadecimal token");
  }

  return value.toLowerCase() as InviteId;
}

export function parsePairingSecret(value: string): PairingSecret {
  if (!PAIRING_SECRET_PATTERN.test(value)) {
    throw new TypeError("PairingSecret must be a 256-bit hexadecimal token");
  }

  return value.toLowerCase() as PairingSecret;
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;

  const detail = (await response.text()).trim();
  throw new Error(
    detail === ""
      ? `Coordinator request failed with HTTP ${response.status}`
      : detail,
  );
}
