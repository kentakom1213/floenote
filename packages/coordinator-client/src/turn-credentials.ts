export type TurnCredentials = {
  iceServers: RTCIceServer[];
  expiresAt: number;
};

const EXPIRY_MARGIN_MS = 60_000;

export class TurnCredentialCache {
  #cached: TurnCredentials | null = null;
  #pending: Promise<TurnCredentials> | null = null;

  get(request: () => Promise<TurnCredentials>): Promise<TurnCredentials> {
    if (this.#cached && this.#cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return Promise.resolve(this.#cached);
    }
    this.#cached = null;
    if (this.#pending) return this.#pending;

    const pending = request().then((credentials) => {
      this.#cached = credentials;
      return credentials;
    }).finally(() => {
      if (this.#pending === pending) this.#pending = null;
    });
    this.#pending = pending;
    return pending;
  }
}

export function parseTurnCredentials(value: unknown): TurnCredentials {
  if (typeof value !== "object" || value === null ||
    !("iceServers" in value) || !Array.isArray(value.iceServers) ||
    value.iceServers.length === 0 ||
    !("expiresAt" in value) || typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
    throw new Error("Coordinator returned invalid TURN credentials");
  }

  let hasTurn = false;
  for (const server of value.iceServers) {
    if (typeof server !== "object" || server === null || !("urls" in server)) {
      throw new Error("Coordinator returned invalid TURN credentials");
    }
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || urls.length === 0 ||
      !urls.every((url) => typeof url === "string" && /^(stun|stuns|turn|turns):\S+$/u.test(url))) {
      throw new Error("Coordinator returned invalid TURN credentials");
    }
    if (urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"))) {
      hasTurn = true;
      if (typeof server.username !== "string" || !server.username ||
        typeof server.credential !== "string" || !server.credential) {
        throw new Error("Coordinator returned invalid TURN credentials");
      }
    }
  }
  if (!hasTurn) throw new Error("Coordinator returned invalid TURN credentials");

  return { iceServers: value.iceServers as RTCIceServer[], expiresAt: value.expiresAt };
}
