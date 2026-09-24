type TurnCredentialResponse = {
  iceServers: RTCIceServer[];
};

export async function resolveRtcConfiguration(
  endpoint: string | null,
): Promise<RTCConfiguration | undefined> {
  if (!endpoint) return undefined;

  try {
    return {
      iceServers: await fetchTurnIceServers(endpoint),
    };
  } catch (error: unknown) {
    console.warn(
      "TURN credentials are unavailable; continuing with the default STUN configuration.",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

export async function resolveRelayRtcConfiguration(
  endpoint: string | null,
): Promise<RTCConfiguration> {
  if (!endpoint) {
    throw new Error("TURN credential endpoint is not configured on this device");
  }

  return {
    iceServers: await fetchTurnIceServers(endpoint),
    iceTransportPolicy: "relay",
  };
}

export async function testTurnCredentialEndpoint(
  endpoint: string,
): Promise<void> {
  await fetchTurnIceServers(endpoint);
}

async function fetchTurnIceServers(endpoint: string): Promise<RTCIceServer[]> {
  const url = parseEndpoint(endpoint);
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`TURN credential endpoint returned HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("TURN credential endpoint did not return valid JSON");
  }

  if (!isTurnCredentialResponse(payload)) {
    throw new Error("TURN credential endpoint returned an invalid ICE configuration");
  }

  const urls = payload.iceServers.flatMap((server) =>
    typeof server.urls === "string" ? [server.urls] : [...server.urls],
  );
  if (!urls.some((value) => value.startsWith("turn:") || value.startsWith("turns:"))) {
    throw new Error("TURN credential endpoint did not return a TURN server");
  }

  return payload.iceServers;
}

function parseEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("TURN credential endpoint must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("TURN credential endpoint must use HTTP or HTTPS");
  }

  return url;
}

function isTurnCredentialResponse(
  value: unknown,
): value is TurnCredentialResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("iceServers" in value) ||
    !Array.isArray(value.iceServers) ||
    value.iceServers.length === 0
  ) {
    return false;
  }

  return value.iceServers.every((server) => {
    if (
      typeof server !== "object" ||
      server === null ||
      !("urls" in server)
    ) {
      return false;
    }

    const urls = server.urls;
    if (
      !(
        typeof urls === "string" ||
        (Array.isArray(urls) &&
          urls.length > 0 &&
          urls.every((url) => typeof url === "string"))
      )
    ) {
      return false;
    }

    if (
      "username" in server &&
      server.username !== undefined &&
      typeof server.username !== "string"
    ) {
      return false;
    }

    if (
      "credential" in server &&
      server.credential !== undefined &&
      typeof server.credential !== "string"
    ) {
      return false;
    }

    return true;
  });
}
