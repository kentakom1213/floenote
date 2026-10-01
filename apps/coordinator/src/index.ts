import { DurableObject } from "cloudflare:workers";
import {
  parseDeviceId,
  parseWorkspaceId,
  type DeviceId,
  type WorkspaceId,
} from "@floe-note/domain";
import {
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
  SECURITY_PROTOCOL_VERSION,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  deriveRevokeDeviceSecurityState,
  encodeAuthorizedPresenceProof,
  encodeAddDeviceTransition,
  encodeCreateWorkspaceTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateWorkspaceTransition,
  encodeUnsignedWorkspaceKeyRotationEnvelope,
  encodeRevokeDeviceTransition,
  encodeUnsignedRevokeDeviceTransition,
  parseAddDeviceWirePayload,
  parseCreateWorkspaceWirePayload,
  parseRevokeDeviceWirePayload,
  parseSecurityStateWirePayload,
  securityStateToWire,
  securityTransitionToWire,
  type SecurityState,
  type SecurityStateWirePayload,
  type SecurityTransitionWirePayload,
} from "@floe-note/security";

import {
  allocateInvitationForAuthorizedPresence,
  authorizePresence,
} from "./invitation-authorization.js";
import { findPresenceSocketsForDevice } from "./presence-routing.js";
import { generateTurnCredentials, TurnCredentialError } from "./turn-credentials.js";

interface Env {
  WORKSPACE_COORDINATOR: DurableObjectNamespace<WorkspaceCoordinator>;
  INVITATION_COORDINATOR: DurableObjectNamespace<InvitationCoordinator>;
  FLOE_VERSION: string;
  FLOE_BUILD: string;
  TURN_ENABLED?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_DEVICE_RATE_LIMIT: RateLimit;
  TURN_INVITE_RATE_LIMIT: RateLimit;
}

type SignalingSocketAttachment = {
  kind: "signaling";
  sessionId: string;
};

type PresenceSocketAttachment = {
  kind: "presence";
  workspaceId: string;
  challenge: string;
  securityHead: string;
  deviceId?: string;
};

type SocketAttachment =
  | SignalingSocketAttachment
  | PresenceSocketAttachment;

type SecurityTransitionRoute = {
  workspaceId: WorkspaceId;
};

type WorkspaceKeyEnvelopeRoute = {
  workspaceId: WorkspaceId;
  keyEpoch: number;
  deviceId: DeviceId;
};

type RevokeKeyEnvelopeWirePayload = {
  protocolVersion: 1;
  workspaceId: string;
  keyEpoch: number;
  securityHead: string;
  recipientDeviceId: string;
  sealedEnvelope: string;
  signerDeviceId: string;
  signature: string;
};

type InvitationState =
  | "waiting"
  | "claimed"
  | "consumed"
  | "cancelled"
  | "expired";

type InvitationRecord = {
  protocolVersion: 1;
  workspaceId: string;
  sessionId: string;
  state: InvitationState;
  expiresAt: number;
  claimedAt?: number;
  claimId?: string;
  consumedAt?: number;
  cancelledAt?: number;
};

const WORKSPACE_ID_PATTERN =
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
      return withCors(
        Response.json({
          ok: true,
          version: env.FLOE_VERSION,
          build: env.FLOE_BUILD,
        }),
      );
    }

    const inviteAction = parseInviteActionRoute(url.pathname);
    if (inviteAction) {
      if (request.method !== "POST") {
        return withCors(new Response("Method not allowed", { status: 405 }));
      }

      const id = env.INVITATION_COORDINATOR.idFromName(inviteAction.inviteId);
      const internalPath = inviteAction.action === "turn-credentials"
        ? `turn-credentials/${inviteAction.inviteId}`
        : inviteAction.action;
      const internalRequest =
        inviteAction.action === "claim" || inviteAction.action === "turn-credentials"
          ? new Request(`https://invitation.internal/${internalPath}`, {
              method: "POST",
              body: await request.text(),
            })
          : new Request(
              `https://invitation.internal/${internalPath}`,
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

      const id = env.WORKSPACE_COORDINATOR.idFromName(securityStateRoute.workspaceId);
      const response = await env.WORKSPACE_COORDINATOR.get(id).fetch(request);
      return withCors(response);
    }

    const securityRoute = parseSecurityTransitionRoute(url.pathname);
    if (securityRoute) {
      if (request.method !== "GET" && request.method !== "POST") {
        return withCors(new Response("Method not allowed", { status: 405 }));
      }

      const id = env.WORKSPACE_COORDINATOR.idFromName(securityRoute.workspaceId);
      const response = await env.WORKSPACE_COORDINATOR.get(id).fetch(request);
      return withCors(response);
    }

    const workspaceKeyEnvelopeRoute = parseWorkspaceKeyEnvelopeRoute(url.pathname);
    if (workspaceKeyEnvelopeRoute) {
      if (request.method !== "GET") {
        return withCors(new Response("Method not allowed", { status: 405 }));
      }

      const id = env.WORKSPACE_COORDINATOR.idFromName(
        workspaceKeyEnvelopeRoute.workspaceId,
      );
      const response = await env.WORKSPACE_COORDINATOR.get(id).fetch(request);
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

    const workspaceId = presenceRoute?.workspaceId ?? signalRoute?.workspaceId;
    if (!workspaceId) {
      return withCors(new Response("Not found", { status: 404 }));
    }

    const id = env.WORKSPACE_COORDINATOR.idFromName(workspaceId);
    return env.WORKSPACE_COORDINATOR.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class WorkspaceCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const securityStateRoute = parseSecurityStateRoute(url.pathname);
    if (securityStateRoute) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      return this.#getSecurityState(securityStateRoute.workspaceId);
    }

    const securityRoute = parseSecurityTransitionRoute(url.pathname);

    if (securityRoute) {
      if (request.method === "GET") {
        return this.#getSecurityTransitions(request, securityRoute.workspaceId);
      }
      if (request.method === "POST") {
        return this.#commitSecurityTransition(request, securityRoute.workspaceId);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    const workspaceKeyEnvelopeRoute = parseWorkspaceKeyEnvelopeRoute(url.pathname);
    if (workspaceKeyEnvelopeRoute) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      return this.#getWorkspaceKeyEnvelope(workspaceKeyEnvelopeRoute);
    }

    const presenceRoute = parsePresenceRoute(url.pathname);
    if (presenceRoute) {
      return this.#openPresenceSocket(presenceRoute.workspaceId);
    }

    const route = parseSignalRoute(url.pathname);

    if (!route) {
      return new Response("Invalid WorkspaceCoordinator route", { status: 404 });
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

  async #openPresenceSocket(workspaceId: WorkspaceId): Promise<Response> {
    const state = await this.#loadSecurityState(workspaceId);
    if (state instanceof Response) return state;

    const challenge = randomHex(AUTHORIZED_PRESENCE_CHALLENGE_BYTES);
    const securityHead = bytesToHex(state.headHash);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.serializeAttachment({
      kind: "presence",
      workspaceId,
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

  async #getSecurityState(workspaceId: WorkspaceId): Promise<Response> {
    const storedWire =
      await this.ctx.storage.get<SecurityStateWirePayload>("security-state");
    if (!storedWire) {
      return new Response("Workspace security is not initialized", {
        status: 404,
      });
    }

    let state: SecurityState;
    try {
      state = parseSecurityStateWirePayload(storedWire, workspaceId);
    } catch {
      return new Response("Stored SecurityState is invalid", { status: 500 });
    }

    return Response.json(securityStateToWire(state));
  }

  async #getSecurityTransitions(
    request: Request,
    workspaceId: WorkspaceId,
  ): Promise<Response> {
    const url = new URL(request.url);
    const rawAfter = url.searchParams.get("after");
    if (rawAfter === null || !/^\d+$/.test(rawAfter)) {
      return new Response("after must be a non-negative integer", {
        status: 400,
      });
    }

    const afterSequence = Number(rawAfter);
    if (!Number.isSafeInteger(afterSequence)) {
      return new Response("after is outside the supported sequence range", {
        status: 400,
      });
    }

    const state = await this.#loadSecurityState(workspaceId);
    if (state instanceof Response) return state;

    if (afterSequence > state.sequence) {
      return new Response(
        "Requested transition sequence is newer than current SecurityState",
        { status: 409 },
      );
    }

    const transitions: SecurityTransitionWirePayload[] = [];
    for (
      let sequence = afterSequence + 1;
      sequence <= state.sequence;
      sequence += 1
    ) {
      const transition =
        await this.ctx.storage.get<SecurityTransitionWirePayload>(
          securityTransitionKey(sequence),
        );
      if (!transition) {
        return new Response(
          `Security transition history is unavailable at sequence ${sequence}`,
          { status: 409 },
        );
      }
      transitions.push(transition);
    }

    return Response.json({
      fromSequence: afterSequence,
      toSequence: state.sequence,
      transitions,
    });
  }

  async #commitSecurityTransition(
    request: Request,
    workspaceId: WorkspaceId,
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
      "type" in payload
    ) {
      if (payload.type === "add-device") {
        return this.#commitAddDevice(payload, workspaceId);
      }
      if (payload.type === "revoke-device") {
        return this.#commitRevokeDevice(payload, workspaceId);
      }
    }

    return this.#commitCreateWorkspace(payload, workspaceId);
  }

  async #commitCreateWorkspace(
    payload: unknown,
    workspaceId: WorkspaceId,
  ): Promise<Response> {
    let transition;
    try {
      transition = parseCreateWorkspaceWirePayload(payload, workspaceId);
    } catch (error: unknown) {
      return new Response(
        error instanceof Error ? error.message : "Invalid CreateWorkspace payload",
        { status: 400 },
      );
    }

    const signingBytes = encodeUnsignedCreateWorkspaceTransition(transition);
    const verified = await verifyEd25519(
      signingBytes,
      transition.signature,
      transition.initialDevice.signingPublicKey,
    );
    if (!verified) {
      return new Response("CreateWorkspace signature verification failed", {
        status: 403,
      });
    }

    const headHash = await sha256(encodeCreateWorkspaceTransition(transition));
    const candidateState = deriveInitialSecurityState(transition, headHash);
    const candidateWire = securityStateToWire(candidateState);

    let response: Response | null = null;

    await this.ctx.storage.transaction(async (transaction) => {
      const existingWire =
        await transaction.get<SecurityStateWirePayload>("security-state");

      if (existingWire) {
        let existing;
        try {
          existing = parseSecurityStateWirePayload(existingWire, workspaceId);
        } catch {
          response = new Response("Stored SecurityState is invalid", {
            status: 500,
          });
          return;
        }

        if (!bytesEqual(existing.headHash, candidateState.headHash)) {
          response = new Response("Workspace security is already initialized", {
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
      await transaction.put(
        securityTransitionKey(transition.sequence),
        securityTransitionToWire(transition),
      );
      response = Response.json(candidateWire, { status: 201 });
    });

    return response ?? new Response("Failed to commit SecurityState", {
      status: 500,
    });
  }

  async #commitAddDevice(
    payload: unknown,
    workspaceId: WorkspaceId,
  ): Promise<Response> {
    let transition;
    try {
      transition = parseAddDeviceWirePayload(payload, workspaceId);
    } catch (error: unknown) {
      return new Response(
        error instanceof Error ? error.message : "Invalid AddDevice payload",
        { status: 400 },
      );
    }

    const existingWire =
      await this.ctx.storage.get<SecurityStateWirePayload>("security-state");
    if (!existingWire) {
      return new Response("Workspace security is not initialized", {
        status: 409,
      });
    }

    let currentState: SecurityState;
    try {
      currentState = parseSecurityStateWirePayload(existingWire, workspaceId);
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
        response = new Response("Workspace security is not initialized", {
          status: 409,
        });
        return;
      }

      let latestState: SecurityState;
      try {
        latestState = parseSecurityStateWirePayload(latestWire, workspaceId);
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
      await transaction.put(
        securityTransitionKey(transition.sequence),
        securityTransitionToWire(transition),
      );
      response = Response.json(candidateWire, { status: 201 });
    });

    return response ?? new Response("Failed to commit AddDevice", {
      status: 500,
    });
  }

  async #commitRevokeDevice(
    payload: unknown,
    workspaceId: WorkspaceId,
  ): Promise<Response> {
    let transition;
    let keyEnvelopes: RevokeKeyEnvelopeWirePayload[];
    try {
      transition = parseRevokeDeviceWirePayload(payload, workspaceId);
      keyEnvelopes = parseRevokeKeyEnvelopes(payload);
    } catch (error: unknown) {
      return new Response(
        error instanceof Error ? error.message : "Invalid RevokeDevice payload",
        { status: 400 },
      );
    }

    const existingWire =
      await this.ctx.storage.get<SecurityStateWirePayload>("security-state");
    if (!existingWire) {
      return new Response("Workspace security is not initialized", { status: 409 });
    }

    let currentState: SecurityState;
    try {
      currentState = parseSecurityStateWirePayload(existingWire, workspaceId);
    } catch {
      return new Response("Stored SecurityState is invalid", { status: 500 });
    }

    const signer = currentState.devices.find(
      (device) => device.deviceId === transition.signerDeviceId,
    );
    if (!signer) {
      return new Response("RevokeDevice signer is not authorized", {
        status: 403,
      });
    }

    const signingBytes = encodeUnsignedRevokeDeviceTransition(transition);
    const verified = await verifyEd25519(
      signingBytes,
      transition.signature,
      signer.signingPublicKey,
    );
    if (!verified) {
      return new Response("RevokeDevice signature verification failed", {
        status: 403,
      });
    }

    const headHash = await sha256(encodeRevokeDeviceTransition(transition));

    if (bytesEqual(currentState.headHash, headHash)) {
      if (!stateMatchesCommittedRevoke(currentState, transition)) {
        return new Response(
          "Stored SecurityState does not match its committed RevokeDevice head",
          { status: 500 },
        );
      }
      return Response.json(securityStateToWire(currentState));
    }

    let candidateState: SecurityState;
    try {
      candidateState = deriveRevokeDeviceSecurityState(
        currentState,
        transition,
        headHash,
      );
    } catch (error: unknown) {
      return new Response(
        error instanceof Error ? error.message : "Invalid RevokeDevice transition",
        { status: 409 },
      );
    }

    const expectedRecipients = candidateState.devices
      .map((device) => device.deviceId)
      .sort();
    const actualRecipients = keyEnvelopes
      .map((envelope) => parseDeviceId(envelope.recipientDeviceId))
      .sort();

    if (
      expectedRecipients.length !== actualRecipients.length ||
      expectedRecipients.some(
        (deviceId, index) => deviceId !== actualRecipients[index],
      )
    ) {
      return new Response(
        "RevokeDevice key envelopes must target every remaining device exactly once",
        { status: 400 },
      );
    }

    for (const envelope of keyEnvelopes) {
      if (
        envelope.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
        envelope.workspaceId !== candidateState.workspaceId ||
        envelope.keyEpoch !== candidateState.keyEpoch ||
        envelope.securityHead !== bytesToHex(candidateState.headHash) ||
        envelope.signerDeviceId !== transition.signerDeviceId
      ) {
        return new Response(
          "WorkspaceKey rotation envelope context does not match RevokeDevice",
          { status: 400 },
        );
      }

      const envelopeSigningBytes = encodeUnsignedWorkspaceKeyRotationEnvelope({
        protocolVersion: SECURITY_PROTOCOL_VERSION,
        workspaceId: candidateState.workspaceId,
        keyEpoch: candidateState.keyEpoch,
        securityHead: candidateState.headHash,
        recipientDeviceId: parseDeviceId(envelope.recipientDeviceId),
        sealedEnvelope: hexToBytes(
          envelope.sealedEnvelope,
          null,
          "sealed WorkspaceKey envelope",
        ),
        signerDeviceId: transition.signerDeviceId,
      });
      const envelopeSignature = hexToBytes(
        envelope.signature,
        64,
        "WorkspaceKey rotation envelope signature",
      );
      if (
        !(await verifyEd25519(
          envelopeSigningBytes,
          envelopeSignature,
          signer.signingPublicKey,
        ))
      ) {
        return new Response(
          "WorkspaceKey rotation envelope signature verification failed",
          { status: 403 },
        );
      }
    }

    const candidateWire = securityStateToWire(candidateState);
    let response: Response | null = null;
    let committed = false;

    await this.ctx.storage.transaction(async (transaction) => {
      const latestWire =
        await transaction.get<SecurityStateWirePayload>("security-state");
      if (!latestWire) {
        response = new Response("Workspace security is not initialized", {
          status: 409,
        });
        return;
      }

      let latestState: SecurityState;
      try {
        latestState = parseSecurityStateWirePayload(latestWire, workspaceId);
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
      await transaction.put(
        securityTransitionKey(transition.sequence),
        securityTransitionToWire(transition),
      );
      for (const envelope of keyEnvelopes) {
        const recipientDeviceId = parseDeviceId(envelope.recipientDeviceId);
        await transaction.put(
          workspaceKeyEnvelopeKey(transition.newKeyEpoch, recipientDeviceId),
          JSON.stringify(envelope),
        );
      }
      response = Response.json(candidateWire, { status: 201 });
      committed = true;
    });

    if (committed) {
      this.#invalidatePresenceForSecurityState(candidateState);
    }

    return response ?? new Response("Failed to commit RevokeDevice", {
      status: 500,
    });
  }

  async #getWorkspaceKeyEnvelope(
    route: WorkspaceKeyEnvelopeRoute,
  ): Promise<Response> {
    const state = await this.#loadSecurityState(route.workspaceId);
    if (state instanceof Response) return state;

    if (
      state.keyEpoch !== route.keyEpoch ||
      !state.devices.some((device) => device.deviceId === route.deviceId)
    ) {
      return new Response("WorkspaceKey envelope is not available", {
        status: 404,
      });
    }

    const envelope = await this.ctx.storage.get<string>(
      workspaceKeyEnvelopeKey(route.keyEpoch, route.deviceId),
    );
    if (!envelope) {
      return new Response("WorkspaceKey envelope is not available", {
        status: 404,
      });
    }

    let parsedEnvelope: RevokeKeyEnvelopeWirePayload;
    try {
      parsedEnvelope = JSON.parse(envelope) as RevokeKeyEnvelopeWirePayload;
    } catch {
      return new Response("Stored WorkspaceKey envelope is invalid", {
        status: 500,
      });
    }

    return Response.json(parsedEnvelope);
  }

  #invalidatePresenceForSecurityState(state: SecurityState): void {
    const head = bytesToHex(state.headHash);
    const authorized = new Set(state.devices.map((device) => device.deviceId));

    for (const socket of this.ctx.getWebSockets(presenceTag())) {
      const attachment = socket.deserializeAttachment() as
        | SocketAttachment
        | null;
      if (attachment?.kind !== "presence") continue;

      if (
        attachment.securityHead !== head ||
        (attachment.deviceId && !authorized.has(parseDeviceId(attachment.deviceId)))
      ) {
        socket.close(1008, "SecurityState changed");
      }
    }
    this.#broadcastPresenceState();
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
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      socket.close(1007, "Invalid authorized-presence JSON");
      return;
    }

    if (attachment.deviceId) {
      await this.#handleAuthenticatedPresenceMessage(
        socket,
        {
          ...attachment,
          deviceId: attachment.deviceId,
        },
        payload,
      );
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

    let workspaceId: WorkspaceId;
    try {
      workspaceId = parseWorkspaceId(attachment.workspaceId);
    } catch {
      socket.close(1011, "Invalid Workspace coordinator identity");
      return;
    }

    const state = await this.#loadSecurityState(workspaceId);
    if (state instanceof Response) {
      socket.close(1011, "Workspace SecurityState is unavailable");
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
      socket.close(1008, "Device is not authorized for this Workspace");
      return;
    }

    const challenge = hexToBytes(
      attachment.challenge,
      AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
      "Presence challenge",
    );
    const signingBytes = encodeAuthorizedPresenceProof({
      protocolVersion: SECURITY_PROTOCOL_VERSION,
      workspaceId,
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

  async #handleAuthenticatedPresenceMessage(
    socket: WebSocket,
    attachment: PresenceSocketAttachment & { deviceId: string },
    payload: unknown,
  ): Promise<void> {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      payload.type === "create-invitation"
    ) {
      if (
        !("requestId" in payload) ||
        typeof payload.requestId !== "number" ||
        !Number.isSafeInteger(payload.requestId) ||
        payload.requestId < 0
      ) {
        socket.close(1007, "Invalid create-invitation request");
        return;
      }

      await this.#createInvitationForAuthorizedDevice(
        socket,
        attachment,
        payload.requestId,
      );
      return;
    }

    if (
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      payload.type === "request-turn-credentials"
    ) {
      if (
        !("requestId" in payload) ||
        typeof payload.requestId !== "number" ||
        !Number.isSafeInteger(payload.requestId) ||
        payload.requestId < 0
      ) {
        socket.close(1007, "Invalid TURN credential request");
        return;
      }
      await this.#requestTurnCredentials(socket, attachment, payload.requestId);
      return;
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("type" in payload) ||
      payload.type !== "reconnect-session" ||
      !("peerDeviceId" in payload) ||
      typeof payload.peerDeviceId !== "string" ||
      !("sessionId" in payload) ||
      typeof payload.sessionId !== "string" ||
      ("transportMode" in payload &&
        payload.transportMode !== "direct" &&
        payload.transportMode !== "relay")
    ) {
      socket.close(1007, "Invalid authorized-presence control message");
      return;
    }

    let workspaceId: WorkspaceId;
    let senderDeviceId: DeviceId;
    let peerDeviceId: DeviceId;
    try {
      workspaceId = parseWorkspaceId(attachment.workspaceId);
      senderDeviceId = parseDeviceId(attachment.deviceId);
      peerDeviceId = parseDeviceId(payload.peerDeviceId);
    } catch {
      socket.close(1008, "Invalid authorized-presence reconnect identity");
      return;
    }

    const sessionId = payload.sessionId.toLowerCase();
    const transportMode =
      "transportMode" in payload && payload.transportMode === "relay"
        ? "relay"
        : "direct";
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      socket.close(1008, "Invalid reconnect signaling session");
      return;
    }

    if (peerDeviceId === senderDeviceId) {
      socket.close(1008, "Reconnect peer must be a different device");
      return;
    }

    const state = await this.#loadSecurityState(workspaceId);
    if (state instanceof Response) {
      socket.close(1011, "Workspace SecurityState is unavailable");
      return;
    }

    if (attachment.securityHead !== bytesToHex(state.headHash)) {
      socket.close(1008, "SecurityState changed during authorized presence");
      return;
    }

    const senderAuthorized = state.devices.some(
      (device) => device.deviceId === senderDeviceId,
    );
    const peerAuthorized = state.devices.some(
      (device) => device.deviceId === peerDeviceId,
    );
    if (!senderAuthorized || !peerAuthorized) {
      socket.close(1008, "Reconnect devices are not authorized");
      return;
    }

    for (const peer of findPresenceSocketsForDevice(
      this.ctx.getWebSockets(presenceTag()),
      peerDeviceId,
    )) {
      sendJson(peer, {
        type: "reconnect-session",
        fromDeviceId: senderDeviceId,
        sessionId,
        transportMode,
      });
    }
  }

  async #createInvitationForAuthorizedDevice(
    socket: WebSocket,
    attachment: PresenceSocketAttachment & { deviceId: string },
    requestId: number,
  ): Promise<void> {
    let workspaceId: WorkspaceId;
    let deviceId: DeviceId;
    try {
      workspaceId = parseWorkspaceId(attachment.workspaceId);
      deviceId = parseDeviceId(attachment.deviceId);
    } catch {
      socket.close(1008, "Invalid authorized-presence invitation identity");
      return;
    }

    const state = await this.#loadSecurityState(workspaceId);
    if (state instanceof Response) {
      socket.close(1011, "Workspace SecurityState is unavailable");
      return;
    }

    const allocation = await allocateInvitationForAuthorizedPresence(
      state,
      {
        workspaceId,
        deviceId,
        securityHead: attachment.securityHead,
      },
      (authorizedWorkspaceId) =>
        createInvitation(this.env, authorizedWorkspaceId),
    );
    if (allocation.kind === "stale-security-head") {
      socket.close(1008, "SecurityState changed during authorized presence");
      return;
    }
    if (allocation.kind === "unauthorized-device") {
      socket.close(1008, "Device is not authorized for this Workspace");
      return;
    }

    const response = allocation.response;
    if (!response.ok) {
      const detail = (await response.text()).trim();
      sendJson(socket, {
        type: "control-error",
        requestId,
        message:
          detail === "" ? "Failed to create invitation" : detail,
      });
      return;
    }

    const invitation = (await response.json()) as {
      inviteId: string;
      sessionId: string;
      expiresAt: number;
    };
    sendJson(socket, {
      type: "invitation-created",
      requestId,
      inviteId: invitation.inviteId,
      sessionId: invitation.sessionId,
      expiresAt: invitation.expiresAt,
    });
  }

  async #requestTurnCredentials(
    socket: WebSocket,
    attachment: PresenceSocketAttachment & { deviceId: string },
    requestId: number,
  ): Promise<void> {
    let workspaceId: WorkspaceId;
    let deviceId: DeviceId;
    try {
      workspaceId = parseWorkspaceId(attachment.workspaceId);
      deviceId = parseDeviceId(attachment.deviceId);
    } catch {
      socket.close(1008, "Invalid authorized-presence TURN identity");
      return;
    }

    const state = await this.#loadSecurityState(workspaceId);
    if (state instanceof Response) {
      sendJson(socket, { type: "control-error", requestId, message: "Workspace SecurityState is unavailable" });
      return;
    }
    const authorization = authorizePresence(state, {
      workspaceId, deviceId, securityHead: attachment.securityHead,
    });
    if (authorization !== "authorized") {
      sendJson(socket, {
        type: "control-error", requestId,
        message: authorization === "stale-security-head"
          ? "SecurityState changed during authorized presence"
          : "Device is not authorized for this Workspace",
      });
      socket.close(1008, "SecurityState changed");
      return;
    }

    if (this.env.TURN_ENABLED !== "true") {
      sendJson(socket, { type: "control-error", requestId, message: "TURN relay is unavailable" });
      return;
    }

    try {
      const { success } = await this.env.TURN_DEVICE_RATE_LIMIT.limit({ key: deviceId });
      if (!success) {
        sendJson(socket, { type: "control-error", requestId, message: "TURN credential request rate limited" });
        return;
      }
      const credentials = await generateTurnCredentials(this.env, `device:${deviceId}`);
      const currentState = await this.#loadSecurityState(workspaceId);
      if (
        currentState instanceof Response ||
        authorizePresence(currentState, {
          workspaceId,
          deviceId,
          securityHead: attachment.securityHead,
        }) !== "authorized"
      ) {
        sendJson(socket, { type: "control-error", requestId, message: "SecurityState changed during authorized presence" });
        socket.close(1008, "SecurityState changed");
        return;
      }
      sendJson(socket, { type: "turn-credentials", requestId, ...credentials });
    } catch (error) {
      sendJson(socket, {
        type: "control-error", requestId,
        message: error instanceof TurnCredentialError ? error.message : "TURN credential service is unavailable",
      });
    }
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
    workspaceId: WorkspaceId,
  ): Promise<SecurityState | Response> {
    const storedWire =
      await this.ctx.storage.get<SecurityStateWirePayload>("security-state");
    if (!storedWire) {
      return new Response("Workspace security is not initialized", { status: 404 });
    }

    try {
      return parseSecurityStateWirePayload(storedWire, workspaceId);
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
        if (url.pathname.startsWith("/turn-credentials/")) {
          return this.#turnCredentials(request, url.pathname.slice("/turn-credentials/".length));
        }
        return new Response("Not found", { status: 404 });
    }
  }

  async #initialize(request: Request): Promise<Response> {
    const payload = (await request.json()) as Partial<InvitationRecord>;
    if (
      payload.protocolVersion !== 1 ||
      typeof payload.workspaceId !== "string" ||
      !WORKSPACE_ID_PATTERN.test(payload.workspaceId) ||
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
      workspaceId: payload.workspaceId,
      sessionId: payload.sessionId,
      state: "waiting",
      expiresAt: payload.expiresAt,
    };
    await this.ctx.storage.put("invite", record);

    return Response.json({
      workspaceId: record.workspaceId,
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

  async #turnCredentials(request: Request, inviteId: string): Promise<Response> {
    if (!INVITE_ID_PATTERN.test(inviteId)) {
      return new Response("Invalid invitation identifier", { status: 400 });
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid TURN credential request", { status: 400 });
    }
    if (typeof payload !== "object" || payload === null ||
      !("claimId" in payload) || typeof payload.claimId !== "string" ||
      !CLAIM_ID_PATTERN.test(payload.claimId)) {
      return new Response("Invalid claim identifier", { status: 400 });
    }
    const record = await this.ctx.storage.get<InvitationRecord>("invite");
    if (!record) return new Response("Invitation not found", { status: 404 });
    if (record.expiresAt <= Date.now()) {
      return new Response("Invitation expired", { status: 410 });
    }
    if (record.state !== "claimed" || record.claimId !== payload.claimId) {
      return new Response("Invitation is not claimed by this device", { status: 409 });
    }
    if (this.env.TURN_ENABLED !== "true") {
      return new Response("TURN relay is unavailable", { status: 503 });
    }

    try {
      const { success } = await this.env.TURN_INVITE_RATE_LIMIT.limit({ key: inviteId });
      if (!success) return new Response("TURN credential request rate limited", { status: 429 });
      const credentials = await generateTurnCredentials(this.env, `invite:${inviteId}`);
      const currentRecord = await this.ctx.storage.get<InvitationRecord>("invite");
      if (
        !currentRecord ||
        currentRecord.state !== "claimed" ||
        currentRecord.claimId !== payload.claimId ||
        currentRecord.expiresAt <= Date.now()
      ) {
        return new Response("Invitation is no longer claimed by this device", { status: 409 });
      }
      return Response.json(credentials, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return new Response(
        error instanceof TurnCredentialError ? error.message : "TURN credential service is unavailable",
        { status: error instanceof TurnCredentialError ? error.status : 503 },
      );
    }
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
  workspaceId: string,
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
            workspaceId,
            sessionId,
            expiresAt,
          }),
        }),
      );

    if (response.ok) {
      return Response.json(
        {
          inviteId,
          sessionId,
          expiresAt,
        },
        { status: 201 },
      );
    }

    if (response.status !== 409) {
      return response;
    }
  }

  return new Response("Could not allocate invitation identifier", {
    status: 503,
  });
}

function parseInviteActionRoute(
  pathname: string,
):
  | {
      inviteId: string;
      action: "claim" | "consume" | "cancel" | "turn-credentials";
    }
  | null {
  const match = /^\/invites\/([^/]+)\/(claim|consume|cancel|turn-credentials)$/.exec(pathname);
  if (!match) return null;

  const [, inviteId, action] = match;
  if (!inviteId || !INVITE_ID_PATTERN.test(inviteId)) return null;
  if (action !== "claim" && action !== "consume" && action !== "cancel" && action !== "turn-credentials") {
    return null;
  }

  return { inviteId, action };
}

function parseSecurityStateRoute(
  pathname: string,
): SecurityTransitionRoute | null {
  const match = /^\/workspaces\/([^/]+)\/security$/.exec(pathname);
  if (!match) return null;

  const rawWorkspaceId = match[1];
  if (!rawWorkspaceId || !WORKSPACE_ID_PATTERN.test(rawWorkspaceId)) return null;

  return {
    workspaceId: parseWorkspaceId(rawWorkspaceId.toLowerCase()),
  };
}

function parseSecurityTransitionRoute(
  pathname: string,
): SecurityTransitionRoute | null {
  const match = /^\/workspaces\/([^/]+)\/security\/transitions$/.exec(pathname);
  if (!match) return null;

  const rawWorkspaceId = match[1];
  if (!rawWorkspaceId || !WORKSPACE_ID_PATTERN.test(rawWorkspaceId)) return null;

  return {
    workspaceId: parseWorkspaceId(rawWorkspaceId.toLowerCase()),
  };
}

function parseWorkspaceKeyEnvelopeRoute(
  pathname: string,
): WorkspaceKeyEnvelopeRoute | null {
  const match =
    /^\/workspaces\/([^/]+)\/workspace-keys\/(\d+)\/([^/]+)$/.exec(pathname);
  if (!match) return null;

  const [, rawWorkspaceId, rawKeyEpoch, rawDeviceId] = match;
  if (
    !rawWorkspaceId ||
    !WORKSPACE_ID_PATTERN.test(rawWorkspaceId) ||
    !rawKeyEpoch ||
    !/^\d+$/.test(rawKeyEpoch) ||
    !rawDeviceId
  ) {
    return null;
  }

  const keyEpoch = Number(rawKeyEpoch);
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) return null;

  try {
    return {
      workspaceId: parseWorkspaceId(rawWorkspaceId.toLowerCase()),
      keyEpoch,
      deviceId: parseDeviceId(rawDeviceId),
    };
  } catch {
    return null;
  }
}

function parsePresenceRoute(
  pathname: string,
): { workspaceId: WorkspaceId } | null {
  const match = /^\/workspaces\/([^/]+)\/presence$/.exec(pathname);
  if (!match) return null;

  const rawWorkspaceId = match[1];
  if (!rawWorkspaceId || !WORKSPACE_ID_PATTERN.test(rawWorkspaceId)) return null;

  return {
    workspaceId: parseWorkspaceId(rawWorkspaceId.toLowerCase()),
  };
}

function parseSignalRoute(
  pathname: string,
): { workspaceId: WorkspaceId; sessionId: string } | null {
  const match = /^\/workspaces\/([^/]+)\/sessions\/([^/]+)$/.exec(pathname);
  if (!match) return null;

  const [, rawWorkspaceId, sessionId] = match;
  if (!rawWorkspaceId || !sessionId) return null;
  if (!WORKSPACE_ID_PATTERN.test(rawWorkspaceId)) return null;
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  return {
    workspaceId: parseWorkspaceId(rawWorkspaceId.toLowerCase()),
    sessionId,
  };
}

function securityTransitionKey(sequence: number): string {
  return `security-transition:${sequence}`;
}

function workspaceKeyEnvelopeKey(
  keyEpoch: number,
  deviceId: DeviceId,
): string {
  return `workspace-key-envelope:${keyEpoch}:${deviceId}`;
}

function parseRevokeKeyEnvelopes(
  payload: unknown,
): RevokeKeyEnvelopeWirePayload[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("keyEnvelopes" in payload) ||
    !Array.isArray(payload.keyEnvelopes)
  ) {
    throw new TypeError("RevokeDevice keyEnvelopes are required");
  }

  const seen = new Set<string>();
  return payload.keyEnvelopes.map((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("protocolVersion" in value) ||
      value.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
      !("workspaceId" in value) ||
      typeof value.workspaceId !== "string" ||
      !("keyEpoch" in value) ||
      typeof value.keyEpoch !== "number" ||
      !Number.isSafeInteger(value.keyEpoch) ||
      !("securityHead" in value) ||
      typeof value.securityHead !== "string" ||
      !("recipientDeviceId" in value) ||
      typeof value.recipientDeviceId !== "string" ||
      !("sealedEnvelope" in value) ||
      typeof value.sealedEnvelope !== "string" ||
      value.sealedEnvelope.length === 0 ||
      value.sealedEnvelope.length > 16 * 1024 ||
      !/^[0-9a-f]+$/u.test(value.sealedEnvelope) ||
      value.sealedEnvelope.length % 2 !== 0 ||
      !("signerDeviceId" in value) ||
      typeof value.signerDeviceId !== "string" ||
      !("signature" in value) ||
      typeof value.signature !== "string"
    ) {
      throw new TypeError("Invalid RevokeDevice WorkspaceKey envelope");
    }

    const recipientDeviceId = parseDeviceId(value.recipientDeviceId);
    if (seen.has(recipientDeviceId)) {
      throw new TypeError("Duplicate RevokeDevice WorkspaceKey recipient");
    }
    seen.add(recipientDeviceId);

    parseWorkspaceId(value.workspaceId);
    parseDeviceId(value.signerDeviceId);
    hexToBytes(value.securityHead, 32, "WorkspaceKey rotation security head");
    hexToBytes(
      value.signature,
      64,
      "WorkspaceKey rotation envelope signature",
    );

    return {
      protocolVersion: SECURITY_PROTOCOL_VERSION,
      workspaceId: value.workspaceId,
      keyEpoch: value.keyEpoch,
      securityHead: value.securityHead,
      recipientDeviceId,
      sealedEnvelope: value.sealedEnvelope,
      signerDeviceId: value.signerDeviceId,
      signature: value.signature,
    };
  });
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
    workspaceId: record.workspaceId,
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
  expectedBytes: number | null,
  label: string,
): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(value) ||
    (expectedBytes !== null && value.length !== expectedBytes * 2)
  ) {
    throw new TypeError(
      expectedBytes === null
        ? `Invalid ${label} hex`
        : `${label} must be ${expectedBytes} bytes of hex`,
    );
  }

  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1) {
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

function stateMatchesCommittedRevoke(
  state: SecurityState,
  transition: ReturnType<typeof parseRevokeDeviceWirePayload>,
): boolean {
  return (
    state.workspaceId === transition.workspaceId &&
    state.sequence === transition.sequence &&
    state.keyEpoch === transition.newKeyEpoch &&
    !state.devices.some(
      (device) => device.deviceId === transition.revokedDeviceId,
    ) &&
    state.devices.some(
      (device) => device.deviceId === transition.signerDeviceId,
    )
  );
}

function stateMatchesCommittedAdd(
  state: SecurityState,
  transition: ReturnType<typeof parseAddDeviceWirePayload>,
): boolean {
  if (
    state.workspaceId !== transition.workspaceId ||
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
