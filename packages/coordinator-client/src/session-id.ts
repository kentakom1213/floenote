declare const sessionIdBrand: unique symbol;

export type SessionId = string & {
  readonly [sessionIdBrand]: "SessionId";
};

const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function createSessionId(): SessionId {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  ) as SessionId;
}

export function parseSessionId(value: string): SessionId {
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new TypeError("SessionId must be a 128-bit hexadecimal token");
  }

  return value.toLowerCase() as SessionId;
}
