import type {
  InviteId,
  PairingSecret,
  SessionId,
} from "@floe-note/coordinator-client";
import type { ProjectId } from "@floe-note/domain";
import type { Transport } from "@floe-note/transport";

export const PAIRING_PROTOCOL_VERSION = 1 as const;

export type PairingRole = "host" | "join";

export type PairingAuthenticationOptions = {
  role: PairingRole;
  inviteId: InviteId;
  projectId: ProjectId;
  sessionId: SessionId;
  pairingSecret: PairingSecret;
  transport: Transport;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type PairingMessage =
  | {
      protocolVersion: typeof PAIRING_PROTOCOL_VERSION;
      type: "hello";
      role: PairingRole;
      nonce: string;
    }
  | {
      protocolVersion: typeof PAIRING_PROTOCOL_VERSION;
      type: "proof";
      role: PairingRole;
      proof: string;
    }
  | {
      protocolVersion: typeof PAIRING_PROTOCOL_VERSION;
      type: "ready";
      role: PairingRole;
    };

const MESSAGE_PREFIX = "floe-note:pairing:v1:";
const DEFAULT_TIMEOUT_MS = 60_000;
const NONCE_BYTES = 16;
const PROOF_BYTES = 32;
const HEX_PATTERN = /^[0-9a-f]+$/i;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function authenticatePairingChannel(
  options: PairingAuthenticationOptions,
): Promise<void> {
  const {
    role,
    inviteId,
    projectId,
    sessionId,
    pairingSecret,
    transport,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (signal?.aborted) {
    throw new Error("Pairing authentication aborted");
  }

  const localNonce = randomHex(NONCE_BYTES);
  const remoteRole = oppositeRole(role);
  const hmacKey = await importHmacKey(pairingSecret);

  await new Promise<void>((resolve, reject) => {
    let remoteNonce: string | null = null;
    let proofSent = false;
    let remoteProofVerified = false;
    let readySent = false;
    let remoteReady = false;
    let finished = false;
    let processing = Promise.resolve();

    const timeout = setTimeout(() => {
      fail(new Error("Pairing authentication timed out"));
    }, timeoutMs);

    const stopMessages = transport.onMessage((data) => {
      processing = processing
        .then(() => handleMessage(data))
        .catch((error: unknown) => {
          fail(
            error instanceof Error
              ? error
              : new Error("Pairing authentication failed"),
          );
        });
    });

    const onAbort = () => fail(new Error("Pairing authentication aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    transport.send(
      encodeMessage({
        protocolVersion: PAIRING_PROTOCOL_VERSION,
        type: "hello",
        role,
        nonce: localNonce,
      }),
    );

    async function handleMessage(data: Uint8Array): Promise<void> {
      if (finished) return;

      const message = decodeMessage(data);
      if (message.role !== remoteRole) {
        throw new Error("Pairing peer used the wrong protocol role");
      }

      switch (message.type) {
        case "hello":
          if (remoteNonce && remoteNonce !== message.nonce) {
            throw new Error("Pairing peer changed its nonce");
          }

          remoteNonce = message.nonce;
          if (!proofSent) {
            proofSent = true;
            transport.send(
              encodeMessage({
                protocolVersion: PAIRING_PROTOCOL_VERSION,
                type: "proof",
                role,
                proof: await createProof(
                  hmacKey,
                  transcript({
                    inviteId,
                    projectId,
                    sessionId,
                    hostNonce: role === "host" ? localNonce : remoteNonce,
                    joinNonce: role === "join" ? localNonce : remoteNonce,
                    proverRole: role,
                  }),
                ),
              }),
            );
          }
          return;

        case "proof":
          if (!remoteNonce) {
            throw new Error("Pairing proof arrived before peer hello");
          }
          if (remoteProofVerified) {
            return;
          }

          remoteProofVerified = await verifyProof(
            hmacKey,
            transcript({
              inviteId,
              projectId,
              sessionId,
              hostNonce: remoteRole === "host" ? remoteNonce : localNonce,
              joinNonce: remoteRole === "join" ? remoteNonce : localNonce,
              proverRole: remoteRole,
            }),
            message.proof,
          );

          if (!remoteProofVerified) {
            throw new Error("PairingSecret authentication failed");
          }

          if (!readySent) {
            readySent = true;
            transport.send(
              encodeMessage({
                protocolVersion: PAIRING_PROTOCOL_VERSION,
                type: "ready",
                role,
              }),
            );
          }

          maybeComplete();
          return;

        case "ready":
          if (!remoteProofVerified) {
            throw new Error("Pairing ready arrived before authentication");
          }

          remoteReady = true;
          maybeComplete();
          return;
      }
    }

    function maybeComplete(): void {
      if (!remoteProofVerified || !readySent || !remoteReady) return;
      finish(resolve);
    }

    function fail(error: Error): void {
      if (finished) return;
      finish(() => reject(error));
    }

    function finish(callback: () => void): void {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      stopMessages();
      signal?.removeEventListener("abort", onAbort);
      callback();
    }
  });
}

function transcript(input: {
  inviteId: InviteId;
  projectId: ProjectId;
  sessionId: SessionId;
  hostNonce: string;
  joinNonce: string;
  proverRole: PairingRole;
}): Uint8Array {
  return textEncoder.encode(
    [
      "floe-note-pairing-v1",
      input.inviteId,
      input.projectId,
      input.sessionId,
      input.hostNonce,
      input.joinNonce,
      input.proverRole,
    ].join("\n"),
  );
}

async function importHmacKey(pairingSecret: PairingSecret): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(hexToBytes(pairingSecret)),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
}

async function createProof(
  key: CryptoKey,
  message: Uint8Array,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(message),
  );
  return bytesToHex(new Uint8Array(signature));
}

async function verifyProof(
  key: CryptoKey,
  message: Uint8Array,
  proof: string,
): Promise<boolean> {
  if (!isHexOfBytes(proof, PROOF_BYTES)) {
    return false;
  }

  return crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(hexToBytes(proof)),
    toArrayBuffer(message),
  );
}

function encodeMessage(message: PairingMessage): Uint8Array {
  return textEncoder.encode(MESSAGE_PREFIX + JSON.stringify(message));
}

function decodeMessage(data: Uint8Array): PairingMessage {
  const text = textDecoder.decode(data);
  if (!text.startsWith(MESSAGE_PREFIX)) {
    throw new Error("Unexpected data received before pairing authentication");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(MESSAGE_PREFIX.length));
  } catch {
    throw new Error("Invalid pairing message");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("protocolVersion" in parsed) ||
    parsed.protocolVersion !== PAIRING_PROTOCOL_VERSION ||
    !("type" in parsed) ||
    typeof parsed.type !== "string" ||
    !("role" in parsed) ||
    (parsed.role !== "host" && parsed.role !== "join")
  ) {
    throw new Error("Invalid pairing message");
  }

  if (parsed.type === "hello") {
    if (
      !("nonce" in parsed) ||
      typeof parsed.nonce !== "string" ||
      !isHexOfBytes(parsed.nonce, NONCE_BYTES)
    ) {
      throw new Error("Invalid pairing hello");
    }

    return {
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      type: "hello",
      role: parsed.role,
      nonce: parsed.nonce.toLowerCase(),
    };
  }

  if (parsed.type === "proof") {
    if (!("proof" in parsed) || typeof parsed.proof !== "string") {
      throw new Error("Invalid pairing proof");
    }

    return {
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      type: "proof",
      role: parsed.role,
      proof: parsed.proof.toLowerCase(),
    };
  }

  if (parsed.type === "ready") {
    return {
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      type: "ready",
      role: parsed.role,
    };
  }

  throw new Error("Unknown pairing message");
}

function oppositeRole(role: PairingRole): PairingRole {
  return role === "host" ? "join" : "host";
}

function randomHex(byteLength: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function isHexOfBytes(value: string, byteLength: number): boolean {
  return value.length === byteLength * 2 && HEX_PATTERN.test(value);
}

function hexToBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !HEX_PATTERN.test(value)) {
    throw new TypeError("Expected hexadecimal data");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
