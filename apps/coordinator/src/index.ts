import { DurableObject } from "cloudflare:workers";

interface Env {
  PROJECT_COORDINATOR: DurableObjectNamespace<ProjectCoordinator>;
  INVITATION_COORDINATOR: DurableObjectNamespace<InvitationCoordinator>;
}

type SocketAttachment = {
  sessionId: string;
};

type InvitationState =
  | "waiting"
  | "claimed"
  | "consumed"
  | "cancelled"
  | "expired";

type InvitationRecord = {
  protocolVersion: 1;
  projectId: string;
  sessionId: string;
  state: InvitationState;
  expiresAt: number;
  claimedAt?: number;
  claimId?: string;
  consumedAt?: number;
  cancelledAt?: number;
};

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/i;
const INVITE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const CLAIM_ID_PATTERN = /^[0-9a-f]{32}$/i;
const MAX_SIGNAL_MESSAGE_BYTES = 64 * 1024;
const INVITE_TTL_MS = 10 * 60_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/health") {
      return withCors(Response.json({ ok: true }));
    }

    const createInviteProjectId = parseCreateInviteRoute(url.pathname);
    if (createInviteProjectId) {
      if (request.method !== "POST") {
        return withCors(new Response("Method not allowed", { status: 405 }));
      }

      return createInvitation(env, createInviteProjectId);
    }

    const inviteAction = parseInviteActionRoute(url.pathname);
    if (inviteAction) {
      if (request.method !== "POST") {
        return withCors(new Response("Method not allowed", { status: 405 }));
      }

      const id = env.INVITATION_COORDINATOR.idFromName(inviteAction.inviteId);
      const response = await env.INVITATION_COORDINATOR
        .get(id)
        .fetch(
          new Request(`https://invitation.internal/${inviteAction.action}`, {
            method: "POST",
          }),
        );

      return withCors(response);
    }

    const signalRoute = parseSignalRoute(url.pathname);
    if (!signalRoute) {
      return withCors(new Response("Not found", { status: 404 }));
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return withCors(new Response("Expected WebSocket upgrade", { status: 426 }));
    }

    const id = env.PROJECT_COORDINATOR.idFromName(signalRoute.projectId);
    return env.PROJECT_COORDINATOR.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class ProjectCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = parseSignalRoute(url.pathname);

    if (!route) {
      return new Response("Invalid signaling route", { status: 404 });
    }

    const tag = sessionTag(route.sessionId);
    const existingPeers = this.ctx.getWebSockets(tag);
    if (existingPeers.length >= 2) {
      return new Response("Signaling session is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.serializeAttachment({
      sessionId: route.sessionId,
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [tag]);

    const peers = this.ctx.getWebSockets(tag);
    if (peers.length === 2) {
      for (const peer of peers) {
        sendJson(peer, { type: "peer-ready" });
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      socket.close(1003, "Signaling messages must be JSON text");
      return;
    }

    if (new TextEncoder().encode(message).byteLength > MAX_SIGNAL_MESSAGE_BYTES) {
      socket.close(1009, "Signaling message is too large");
      return;
    }

    if (!isSignalEnvelope(message)) {
      socket.close(1007, "Invalid signaling message");
      return;
    }

    const attachment = socket.deserializeAttachment() as
      | SocketAttachment
      | null;
    if (!attachment) {
      socket.close(1011, "Missing signaling session");
      return;
    }

    for (const peer of this.ctx.getWebSockets(sessionTag(attachment.sessionId))) {
      if (peer !== socket) {
        peer.send(message);
      }
    }
  }

  async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    this.#notifyPeerLeft(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.#notifyPeerLeft(socket);
  }

  #notifyPeerLeft(socket: WebSocket): void {
    const attachment = socket.deserializeAttachment() as
      | SocketAttachment
      | null;
    if (!attachment) return;

    for (const peer of this.ctx.getWebSockets(sessionTag(attachment.sessionId))) {
      if (peer !== socket) {
        sendJson(peer, { type: "peer-left" });
      }
    }
  }
}

export class InvitationCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case "/initialize":
        return this.#initialize(request);
      case "/claim":
        return this.#claim(request);
      case "/consume":
        return this.#consume();
      case "/cancel":
        return this.#cancel();
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  async #initialize(request: Request): Promise<Response> {
    const payload = (await request.json()) as Partial<InvitationRecord>;
    if (
      payload.protocolVersion !== 1 ||
      typeof payload.projectId !== "string" ||
      !PROJECT_ID_PATTERN.test(payload.projectId) ||
      typeof payload.sessionId !== "string" ||
      !SESSION_ID_PATTERN.test(payload.sessionId) ||
      typeof payload.expiresAt !== "number"
    ) {
      return new Response("Invalid invitation initialization", { status: 400 });
    }

    const existing = await this.ctx.storage.get<InvitationRecord>("invite");
    if (existing) {
      return new Response("Invitation already initialized", { status: 409 });
    }

    const record: InvitationRecord = {
      protocolVersion: 1,
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      state: "waiting",
      expiresAt: payload.expiresAt,
    };
    await this.ctx.storage.put("invite", record);

    return Response.json({
      projectId: record.projectId,
      sessionId: record.sessionId,
      state: record.state,
      expiresAt: record.expiresAt,
    });
  }

  async #claim(request: Request): Promise<Response> {
    const payload = (await request.json()) as { claimId?: unknown };
    if (
      typeof payload.claimId !== "string" ||
      !CLAIM_ID_PATTERN.test(payload.claimId)
    ) {
      return new Response("Invalid claim identifier", { status: 400 });
    }

    const claimId = payload.claimId.toLowerCase();
    let response: Response | null = null;

    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<InvitationRecord>("invite");
      if (!record) {
        response = new Response("Invitation not found", { status: 404 });
        return;
      }

      const now = Date.now();
      if (record.expiresAt <= now) {
        if (record.state !== "expired") {
          await transaction.put("invite", {
            ...record,
            state: "expired",
          } satisfies InvitationRecord);
        }
        response = new Response("Invitation expired", { status: 410 });
        return;
      }

      if (record.state === "claimed" && record.claimId === claimId) {
        response = claimedInvitationResponse(record);
        return;
      }

      if (record.state !== "waiting") {
        response = new Response(
          `Invitation is already ${record.state}`,
          { status: 409 },
        );
        return;
      }

      const claimed: InvitationRecord = {
        ...record,
        state: "claimed",
        claimId,
        claimedAt: now,
      };
      await transaction.put("invite", claimed);

      response = claimedInvitationResponse(claimed);
    });

    return response ?? new Response("Failed to claim invitation", { status: 500 });
  }

  async #consume(): Promise<Response> {
    let response: Response | null = null;

    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<InvitationRecord>("invite");
      if (!record) {
        response = new Response("Invitation not found", { status: 404 });
        return;
      }

      if (record.state === "consumed") {
        response = new Response(null, { status: 204 });
        return;
      }

      if (record.state !== "claimed") {
        response = new Response(
          `Invitation cannot be consumed from state ${record.state}`,
          { status: 409 },
        );
        return;
      }

      await transaction.put("invite", {
        ...record,
        state: "consumed",
        consumedAt: Date.now(),
      } satisfies InvitationRecord);
      response = new Response(null, { status: 204 });
    });

    return response ?? new Response("Failed to consume invitation", { status: 500 });
  }

  async #cancel(): Promise<Response> {
    let response: Response | null = null;

    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<InvitationRecord>("invite");
      if (!record) {
        response = new Response("Invitation not found", { status: 404 });
        return;
      }

      if (record.state === "cancelled") {
        response = new Response(null, { status: 204 });
        return;
      }

      if (record.state === "consumed") {
        response = new Response("Consumed invitation cannot be cancelled", {
          status: 409,
        });
        return;
      }

      await transaction.put("invite", {
        ...record,
        state: "cancelled",
        cancelledAt: Date.now(),
      } satisfies InvitationRecord);
      response = new Response(null, { status: 204 });
    });

    return response ?? new Response("Failed to cancel invitation", { status: 500 });
  }
}

async function createInvitation(
  env: Env,
  projectId: string,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inviteId = randomHex(16);
    const sessionId = randomHex(16);
    const expiresAt = Date.now() + INVITE_TTL_MS;
    const id = env.INVITATION_COORDINATOR.idFromName(inviteId);
    const response = await env.INVITATION_COORDINATOR
      .get(id)
      .fetch(
        new Request("https://invitation.internal/initialize", {
          method: "POST",
          body: JSON.stringify({
            protocolVersion: 1,
            projectId,
            sessionId,
            expiresAt,
          }),
        }),
      );

    if (response.ok) {
      return withCors(
        Response.json(
          {
            inviteId,
            sessionId,
            expiresAt,
          },
          { status: 201 },
        ),
      );
    }

    if (response.status !== 409) {
      return withCors(response);
    }
  }

  return withCors(
    new Response("Could not allocate invitation identifier", { status: 503 }),
  );
}

function parseCreateInviteRoute(pathname: string): string | null {
  const match = /^\/projects\/([^/]+)\/invites$/.exec(pathname);
  if (!match) return null;

  const projectId = match[1];
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) return null;
  return projectId;
}

function parseInviteActionRoute(
  pathname: string,
):
  | {
      inviteId: string;
      action: "claim" | "consume" | "cancel";
    }
  | null {
  const match = /^\/invites\/([^/]+)\/(claim|consume|cancel)$/.exec(pathname);
  if (!match) return null;

  const [, inviteId, action] = match;
  if (!inviteId || !INVITE_ID_PATTERN.test(inviteId)) return null;
  if (action !== "claim" && action !== "consume" && action !== "cancel") {
    return null;
  }

  return { inviteId, action };
}

function parseSignalRoute(
  pathname: string,
): { projectId: string; sessionId: string } | null {
  const match = /^\/projects\/([^/]+)\/sessions\/([^/]+)$/.exec(pathname);
  if (!match) return null;

  const [, projectId, sessionId] = match;
  if (!projectId || !sessionId) return null;
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  return { projectId, sessionId };
}

function sessionTag(sessionId: string): string {
  return `session:${sessionId}`;
}

function isSignalEnvelope(message: string): boolean {
  try {
    const parsed = JSON.parse(message) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      parsed.type === "signal" &&
      "signal" in parsed
    );
  } catch {
    return false;
  }
}

function claimedInvitationResponse(record: InvitationRecord): Response {
  return Response.json({
    projectId: record.projectId,
    sessionId: record.sessionId,
    state: record.state,
    expiresAt: record.expiresAt,
  });
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sendJson(socket: WebSocket, value: unknown): void {
  try {
    socket.send(JSON.stringify(value));
  } catch {
    // A peer may disappear between getWebSockets() and send().
  }
}
