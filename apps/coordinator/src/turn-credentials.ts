export type TurnConfiguration = {
  TURN_ENABLED?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
};

export type TurnCredentials = {
  iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  expiresAt: number;
};

const TURN_CREDENTIAL_TTL_SECONDS = 86_400;

export class TurnCredentialError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function generateTurnCredentials(
  env: TurnConfiguration,
  customIdentifier: string,
): Promise<TurnCredentials> {
  if (env.TURN_ENABLED !== "true") {
    throw new TurnCredentialError("TURN relay is unavailable", 503);
  }
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    throw new TurnCredentialError("TURN credential service is not configured", 503);
  }

  const requestedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttl: TURN_CREDENTIAL_TTL_SECONDS,
          customIdentifier,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TurnCredentialError("Could not generate TURN credentials", 502);
  }

  if (!response.ok) {
    throw new TurnCredentialError("Could not generate TURN credentials", 502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TurnCredentialError("Cloudflare TURN returned an invalid response", 502);
  }

  if (!isIceServerResponse(payload)) {
    throw new TurnCredentialError("Cloudflare TURN returned an invalid response", 502);
  }

  return {
    iceServers: payload.iceServers.map((server) => ({
      urls: server.urls,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    })),
    expiresAt: requestedAt + TURN_CREDENTIAL_TTL_SECONDS * 1_000,
  };
}

function isIceServerResponse(
  value: unknown,
): value is Pick<TurnCredentials, "iceServers"> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("iceServers" in value) ||
    !Array.isArray(value.iceServers) ||
    value.iceServers.length === 0
  ) {
    return false;
  }

  let hasTurn = false;
  for (const server of value.iceServers) {
    if (typeof server !== "object" || server === null || !("urls" in server)) {
      return false;
    }
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || urls.length === 0 ||
      !urls.every((url) => typeof url === "string" &&
        /^(stun|stuns|turn|turns):\S+$/u.test(url))) {
      return false;
    }
    const usesTurn = urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
    if (usesTurn) {
      hasTurn = true;
      if (typeof server.username !== "string" || !server.username ||
        typeof server.credential !== "string" || !server.credential) {
        return false;
      }
    }
    if (("username" in server && server.username !== undefined && typeof server.username !== "string") ||
      ("credential" in server && server.credential !== undefined && typeof server.credential !== "string")) {
      return false;
    }
  }
  return hasTurn;
}
