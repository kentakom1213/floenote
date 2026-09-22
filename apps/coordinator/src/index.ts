import { DurableObject } from "cloudflare:workers";
import {
  parseDeviceId,
  parseProjectId,
  type DeviceId,
  type ProjectId,
} from "@floe-note/domain";
import {
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_PROTOCOL_VERSION,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  encodeAuthorizedPresenceProof,
  encodeAddDeviceTransition,
  encodeCreateProjectTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateProjectTransition,
  parseAddDeviceWirePayload,
  parseCreateProjectWirePayload,
  parseSecurityStateWirePayload,
  securityStateToWire,
  type SecurityState,
  type SecurityStateWirePayload,
} from "@floe-note/security";

interface Env {
  PROJECT_COORDINATOR: DurableObjectNamespace<ProjectCoordinator>;
  INVITATION_COORDINATOR: DurableObjectNamespace<InvitationCoordinator>;
}

type SignalingSocketAttachment = {
  kind: "signaling";
  sessionId: string;
};

type PresenceSocketAttachment = {
  kind: "presence";
  projectId: string;
  challenge: string;
  securityHead: string;
  deviceId?: string;
};

type SocketAttachment =
  | SignalingSocketAttachment
  | PresenceSocketAttachment;

type SecurityTransitionRoute = {
  projectId: ProjectId;
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
      const internalRequest =
        inviteAction.action === "claim"
          ? new Request("https://invitation.internal/claim", {
              method: "POST",
              body: await request.text(),
            })
          : new Request(
              `https://invitation.internal/${inviteAction.action}`,
              { method: "POST" },
            );
      const response = await env.INVITATION_COORDINATOR
        .get(id)
        .fetch(internalRequest);

      return withCors(response);
    }

    const securityStateRoute = parseSecurityStateRoute(url.pathname);
    if (securityStateRoute) {
      if (request.method !== "GET") {
        return withCors(new Response("Method not allowed", { status: 405 }));
      }

      const id = env.PROJECT_COORDINATOR.idFromName(securityStateRoute.projectId);
      const response = await env.PROJECT_COORDINATOR.get(id).fetch(request);
      return withCors(response);
    }

    const securityRoute = parseSecurityTransitionRoute(url.pathname);
    if (securityRoute) {
      if (request.method !== "POST") {
        return withCors(new Response("Method not allowed", { status: 405 }));
      }

      const id = env.PROJECT_COORDINATOR.idFromName(securityRoute.projectId);
      const response = await env.PROJECT_COORDINATOR.get(id).fetch(request);
      return withCors(response);
    }

    const presenceRoute = parsePresenceRoute(url.pathname);
    const signalRoute = parseSignalRoute(url.pathname);
    if (!presenceRoute && !signalRoute) {
      return withCors(new Response("Not found", { status: 404 }));
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return withCors(new Response("Expected WebSocket upgrade", { status: 426 }));
    }

    const projectId = presenceRoute?.projectId ?? signalRoute?.projectId;
    if (!projectId) {
      return withCors(new Response("Not found", { status: 404 }));
    }

    const id = env.PROJECT_COORDINATOR.idFromName(projectId);
    return env.PROJECT_COORDINATOR.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class ProjectCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const securityStateRoute = parseSecurityStateRoute(url.pathname);
    if (securityStateRoute) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      return this.#getSecurityState(securityStateRoute.projectId);
    }

    const securityRoute = parseSecurityTransitionRoute(url.pathname);

    if (securityRoute) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      return this.#commitSecurityTransition(request, securityRoute.projectId);
    }

    const presenceRoute = parsePresenceRoute(url.pathname);
    if (presenceRoute) {
      return this.#openPresenceSocket(presenceRoute.projectId);
    }

    const route = parseSignalRoute(url.pathname);

    if (!route) {
      return new Response("Invalid ProjectCoordinator route", { status: 404 });
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
      kind: "signaling",
      sessionId: route.sessionId,
    } satisfies SignalingSocketAttachment);
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

  async #openPresenceSocket(projectId: ProjectId): Promise<Response> {
    const state = await this.#loadSecurityState(projectId);
    if (state instanceof Response) return state;

    const challenge = randomHex(AUTHORIZED_PRESENCE_CHALLENGE_BYTES);
    const securityHead = bytesToHex(state.headHash);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.serializeAttachment({
      kind: "presence",
      projectId,
      challenge,
      securityHead,
    } satisfies PresenceSocketAttachment);
    this.ctx.acceptWebSocket(server, [presenceTag()]);

    sendJson(server, {
      type: "presence-challenge",
      challenge,
      securityHead,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async #getSecurityState(projectId: ProjectId): Promise<Response> {
    const storedWire =
      await this.ctx.storage.get<SecurityStateWirePayload>("security-state");
    if (!storedWire) {
      return new Response("Project security is not initialized", {
        status: 404,
      });
    }

    let state: SecurityState;
    try {
      state = parseSecurityStateWirePayload(storedWire, projectId);
    } catch {
      return new Response("Stored SecurityState is invalid", { status: 500 });
    }

    return Response.json(securityStateToWire(state));
  }

  async #commitSecurityTransition(
    request: Request,
    projectId: ProjectId,
  ): Promise<Response> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON security transition", { status: 400 });
    }

    if (
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      payload.type === "add-device"
    ) {
      return this.#commitAddDevice(payload, projectId);
    }

    return this.#commitCreateProject(payload, projectId);
  }

  async #commitCreateProject(
    payload: unknown,
    projectId: ProjectId,
  ): Promise<Response> {
    let transition;
    try {
      transition = parseCreateProjectWirePayload(payload, projectId);
    } catch (error: unknown) {
      return new Response(
        error instanceof Error ? error.message : "Invalid CreateProject payload",
        { status: 400 },
      );
    }

    const signingBytes = encodeUnsignedCreateProjectTransition(transition);
    const verified = await verifyEd25519(
      signingBytes,
      transition.signature,
      transition.initialDevice.signingPublicKey,
    );
    if (!verified) {
      return new Response("CreateProject signature verification failed", {
        status: 403,
      });
    }

    const headHash = await sha256(encodeCreateProjectTransition(transition));
    const candidateState = deriveInitialSecurityState(transition, headHash);
    const candidateWire = securityStateToWire(candidateState);

    let response: Response | null = null;

    await this.ctx.storage.transaction(async (transaction) => {
      const existingWire =
        await transaction.get<SecurityStateWirePayload>("security-state");

      if (existingWire) {
        let existing;
        try {
          existing = parseSecurityStateWirePayload(existingWire, projectId);
        } catch {
          response = new Response("Stored SecurityState is invalid", {
            status: 500,
          });
          return;
        }

        if (!bytesEqual(existing.headHash, candidateState.headHash)) {
          response = new Response("Project security is already initialized", {
            status: 409,
          });
          return;
        }

        if (
          JSON.stringify(securityStateToWire(existing)) !==
          JSON.stringify(candidateWire)
        ) {
          response = new Response(
            "Stored SecurityState does not match its committed head",
            { status: 500 },
          );
          return;
        }

        response = Response.json(securityStateToWire(existing));
        return;
      }

      await transaction.put("security-state", candidateWire);
      response = Response.json(candidateWire, { status: 201 });
    });

    return response ?? new Response("Failed to commit SecurityState", {
      status: 500,
    });
  }

  async #commitAddDevice(
    payload: unknown,
    projectId: ProjectId,
  ): Promise<Response> {
    let transition;
    try {
      transition = parseAddDeviceWirePayload(payload, projectId);
    } catch (error: unknown) {
      return new Response(
        error instanceof Error ? error.message : "Invalid AddDevice payload",
        { status: 400 },
      );
    }

    const existingWire =
      await this.ctx.storage.get<SecurityStateWirePayload>("security-state");
    if (!existingWire) {
      return new Response("Project security is not initialized", {
        status: 409,
      });
    }

    let currentState: SecurityState;
    try {
      currentState = parseSecurityStateWirePayload(existingWire, projectId);
    } catch {
      return new Response("Stored SecurityState is invalid", { status: 500 });
    }

    const signer = currentState.devices.find(
      (device) => device.deviceId === transition.signerDeviceId,
    );
    if (!signer) {
      return new Response("AddDevice signer is not authorized", {
        status: 403,
      });
    }

    const signingBytes = encodeUnsignedAddDeviceTransition(transition);
    const verified = await verifyEd25519(
      signingBytes,
      transition.signature,
      signer.signingPublicKey,
    );
    if (!verified) {
      return new Response("AddDevice signature verification failed", {
        status: 403,
      });
    }

    const headHash = await sha256(encodeAddDeviceTransition(transition));

    if (bytesEqual(currentState.headHash, headHash)) {
      if (!stateMatchesCommittedAdd(currentState, transition)) {
        return new Response(
          "Stored SecurityState does not match its committed AddDevice head",
          { status: 500 },
        );
      }
      return Response.json(securityStateToWire(currentState));
    }

    let candidateState: SecurityState;
    try {
      candidateState = deriveAddDeviceSecurityState(
        currentState,
        transition,
        headHash,
      );
    } catch (error: unknown) {
      return new Response(
        error instanceof Error ? error.message : "Invalid AddDevice transition",
        { status: 409 },
      );
    }

    const candidateWire = securityStateToWire(candidateState);
    let response: Response | null = null;

    await this.ctx.storage.transaction(async (transaction) => {
      const latestWire =
        await transaction.get<SecurityStateWirePayload>("security-state");
      if (!latestWire) {
        response = new Response("Project security is not initialized", {
          status: 409,
        });
        return;
      }

      let latestState: SecurityState;
      try {
        latestState = parseSecurityStateWirePayload(latestWire, projectId);
      } catch {
        response = new Response("Stored SecurityState is invalid", {
          status: 500,
        });
        return;
      }

      if (!bytesEqual(latestState.headHash, currentState.headHash)) {
        response = new Response("SecurityState head changed", { status: 409 });
        return;
      }

      await transaction.put("security-state", candidateWire);
      response = Response.json(candidateWire, { status: 201 });
    });

    return response ?? new Response("Failed to commit AddDevice", {
      status: 500,
    });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      socket.close(1003, "WebSocket messages must be JSON text");
      return;
    }

    if (new TextEncoder().encode(message).byteLength > MAX_SIGNAL_MESSAGE_BYTES) {
      socket.close(1009, "WebSocket message is too large");
      return;
    }

    const attachment = socket.deserializeAttachment() as
      | SocketAttachment
      | null;
    if (!attachment) {
      socket.close(1011, "Missing WebSocket attachment");
      return;
    }

    if (attachment.kind === "presence") {
      await this.#handlePresenceMessage(socket, attachment, message);
      return;
    }

    if (!isSignalEnvelope(message)) {
      socket.close(1007, "Invalid signaling message");
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
    this.#handleSocketDeparture(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.#handleSocketDeparture(socket);
  }

  async #handlePresenceMessage(
    socket: WebSocket,
    attachment: PresenceSocketAttachment,
    message: string,
  ): Promise<void> {
    if (attachment.deviceId) {
      socket.close(1008, "Authorized presence is already authenticated");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      socket.close(1007, "Invalid authorized-presence JSON");
      return;
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("type" in payload) ||
      payload.type !== "presence-auth" ||
      !("deviceId" in payload) ||
      typeof payload.deviceId !== "string" ||
      !("signature" in payload) ||
      typeof payload.signature !== "string"
    ) {
      socket.close(1007, "Invalid authorized-presence authentication");
      return;
    }

    let deviceId: DeviceId;
    let signature: Uint8Array;
    try {
      deviceId = parseDeviceId(payload.deviceId);
      signature = hexToBytes(payload.signature, 64, "Presence signature");
    } catch {
      socket.close(1008, "Invalid authorized-presence identity");
      return;
    }

    let projectId: ProjectId;
    try {
      projectId = parseProjectId(attachment.projectId);
    } catch {
      socket.close(1011, "Invalid Project coordinator identity");
      return;
    }

    const state = await this.#loadSecurityState(projectId);
    if (state instanceof Response) {
      socket.close(1011, "Project SecurityState is unavailable");
      return;
    }

    if (attachment.securityHead !== bytesToHex(state.headHash)) {
      socket.close(1008, "SecurityState changed during presence authentication");
      return;
    }

    const authorizedDevice = state.devices.find(
      (device) => device.deviceId === deviceId,
    );
    if (!authorizedDevice) {
      socket.close(1008, "Device is not authorized for this Project");
      return;
    }

    const challenge = hexToBytes(
      attachment.challenge,
      AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
      "Presence challenge",
    );
    const signingBytes = encodeAuthorizedPresenceProof({
      protocolVersion: SECURITY_PROTOCOL_VERSION,
      projectId,
      deviceId,
      securityHead: state.headHash,
      challenge,
    });
    const verified = await verifyEd25519(
      signingBytes,
      signature,
      authorizedDevice.signingPublicKey,
    );
    if (!verified) {
      socket.close(1008, "Authorized-presence signature verification failed");
      return;
    }

    socket.serializeAttachment({
      ...attachment,
      deviceId,
    } satisfies PresenceSocketAttachment);

    this.#broadcastPresenceState();
  }

  #handleSocketDeparture(socket: WebSocket): void {
    const attachment = socket.deserializeAttachment() as
      | SocketAttachment
      | null;
    if (!attachment) return;

    if (attachment.kind === "presence") {
      if (attachment.deviceId) this.#broadcastPresenceState(socket);
      return;
    }

    for (const peer of this.ctx.getWebSockets(sessionTag(attachment.sessionId))) {
      if (peer !== socket) {
        sendJson(peer, { type: "peer-left" });
      }
    }
  }

  #broadcastPresenceState(exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets(presenceTag());
    const authenticated = sockets.flatMap((peer) => {
      if (peer === exclude) return [];
      const attachment = peer.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.kind !== "presence" || !attachment.deviceId) return [];
      return [attachment.deviceId];
    });
    const deviceIds = [...new Set(authenticated)].sort();

    for (const peer of sockets) {
      if (peer === exclude) continue;
      const attachment = peer.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.kind === "presence" && attachment.deviceId) {
        sendJson(peer, { type: "presence-state", deviceIds });
      }
    }
  }

  async #loadSecurityState(
    projectId: ProjectId,
  ): Promise<SecurityState | Response> {
    const storedWire =
      await this.ctx.storage.get<SecurityStateWirePayload>("security-state");
    if (!storedWire) {
      return new Response("Project security is not initialized", { status: 404 });
    }

    try {
      return parseSecurityStateWirePayload(storedWire, projectId);
    } catch {
      return new Response("Stored SecurityState is invalid", { status: 500 });
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

function parseSecurityStateRoute(
  pathname: string,
): SecurityTransitionRoute | null {
  const match = /^\/projects\/([^/]+)\/security$/.exec(pathname);
  if (!match) return null;

  const rawProjectId = match[1];
  if (!rawProjectId || !PROJECT_ID_PATTERN.test(rawProjectId)) return null;

  return {
    projectId: parseProjectId(rawProjectId.toLowerCase()),
  };
}

function parseSecurityTransitionRoute(
  pathname: string,
): SecurityTransitionRoute | null {
  const match = /^\/projects\/([^/]+)\/security\/transitions$/.exec(pathname);
  if (!match) return null;

  const rawProjectId = match[1];
  if (!rawProjectId || !PROJECT_ID_PATTERN.test(rawProjectId)) return null;

  return {
    projectId: parseProjectId(rawProjectId.toLowerCase()),
  };
}

function parsePresenceRoute(
  pathname: string,
): { projectId: ProjectId } | null {
  const match = /^\/projects\/([^/]+)\/presence$/.exec(pathname);
  if (!match) return null;

  const rawProjectId = match[1];
  if (!rawProjectId || !PROJECT_ID_PATTERN.test(rawProjectId)) return null;

  return {
    projectId: parseProjectId(rawProjectId.toLowerCase()),
  };
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

function presenceTag(): string {
  return "presence";
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
  return bytesToHex(bytes);
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(
  value: string,
  expectedBytes: number,
  label: string,
): Uint8Array {
  if (
    value.length !== expectedBytes * 2 ||
    !/^[0-9a-f]+$/i.test(value)
  ) {
    throw new TypeError(`${label} must be ${expectedBytes} bytes of hex`);
  }

  const result = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

async function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      toArrayBuffer(signature),
      toArrayBuffer(message),
    );
  } catch {
    return false;
  }
}

async function sha256(message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(message)),
  );
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function stateMatchesCommittedAdd(
  state: SecurityState,
  transition: ReturnType<typeof parseAddDeviceWirePayload>,
): boolean {
  if (
    state.projectId !== transition.projectId ||
    state.sequence !== transition.sequence
  ) {
    return false;
  }

  const added = state.devices.find(
    (device) => device.deviceId === transition.newDevice.deviceId,
  );
  if (!added || added.addedAtSequence !== transition.sequence) {
    return false;
  }

  return (
    bytesEqual(
      added.encryptionPublicKey,
      transition.newDevice.encryptionPublicKey,
    ) &&
    bytesEqual(
      added.signingPublicKey,
      transition.newDevice.signingPublicKey,
    )
  );
}
