interface Env {
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
  TURN_ACCESS_TOKEN: string;
}

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type CloudflareTurnResponse = {
  iceServers: IceServer[];
};

const TURN_CREDENTIAL_TTL_SECONDS = 86_400;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const accessToken = parseCredentialRoute(url.pathname);
    if (!accessToken) {
      return withCors(new Response("Not found", { status: 404 }));
    }

    if (request.method !== "GET") {
      return withCors(new Response("Method not allowed", { status: 405 }));
    }

    if (!env.TURN_ACCESS_TOKEN || accessToken !== env.TURN_ACCESS_TOKEN) {
      return withCors(new Response("Not found", { status: 404 }));
    }

    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return withCors(
        new Response("TURN credential service is not configured", {
          status: 503,
        }),
      );
    }

    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
      },
    );

    if (!upstream.ok) {
      console.error("Cloudflare TURN credential request failed", {
        status: upstream.status,
      });
      return withCors(
        new Response("Could not generate TURN credentials", { status: 502 }),
      );
    }

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      return withCors(
        new Response("Cloudflare TURN returned invalid JSON", { status: 502 }),
      );
    }

    if (!isCloudflareTurnResponse(payload)) {
      return withCors(
        new Response("Cloudflare TURN returned an invalid response", {
          status: 502,
        }),
      );
    }

    return withCors(
      Response.json(payload, {
        headers: {
          "Cache-Control": "no-store",
        },
      }),
    );
  },
} satisfies ExportedHandler<Env>;

function parseCredentialRoute(pathname: string): string | null {
  const match = /^\/credentials\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}

function isCloudflareTurnResponse(value: unknown): value is CloudflareTurnResponse {
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

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Cache-Control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
