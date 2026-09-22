import { DurableObject } from "cloudflare:workers";

interface Env {
  PROJECT_COORDINATOR: DurableObjectNamespace<ProjectCoordinator>;
}

type SocketAttachment = {
  sessionId: string;
};

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/i;
const MAX_SIGNAL_MESSAGE_BYTES = 64 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    const route = parseSignalRoute(url.pathname);
    if (!route) {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const id = env.PROJECT_COORDINATOR.idFromName(route.projectId);
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

function sendJson(socket: WebSocket, value: unknown): void {
  try {
    socket.send(JSON.stringify(value));
  } catch {
    // A peer may disappear between getWebSockets() and send().
  }
}
