import {
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
  DEVICE_SIGNING_PUBLIC_KEY_BYTES,
} from "@floe-note/crypto";
import { parseDeviceId } from "@floe-note/domain";
import type { DevicePublicIdentity } from "@floe-note/security";
import type { Transport } from "@floe-note/transport";

export type DeviceBootstrapRole = "host" | "join";

export type JoiningDeviceInfo = DevicePublicIdentity & {
  displayName: string;
};

export type DeviceBootstrapOptions =
  | {
      role: "host";
      transport: Transport;
      signal?: AbortSignal;
      timeoutMs?: number;
    }
  | {
      role: "join";
      transport: Transport;
      identity: DevicePublicIdentity;
      displayName: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    };

type DeviceBootstrapMessage =
  | {
      protocolVersion: 1;
      type: "device-identity-request";
    }
  | {
      protocolVersion: 1;
      type: "device-identity";
      deviceId: string;
      encryptionPublicKey: string;
      signingPublicKey: string;
      displayName: string;
    }
  | {
      protocolVersion: 1;
      type: "device-identity-ack";
      deviceId: string;
    };

const MESSAGE_PREFIX = "floe-note:pairing-device:v1:";
const DEFAULT_TIMEOUT_MS = 30_000;
const HEX_PATTERN = /^[0-9a-f]+$/i;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function exchangeJoiningDeviceIdentity(
  options: DeviceBootstrapOptions,
): Promise<JoiningDeviceInfo> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { transport, signal } = options;

  if (signal?.aborted) {
    throw new Error("Device bootstrap aborted");
  }

  return new Promise<JoiningDeviceInfo>((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      fail(new Error("Device bootstrap timed out"));
    }, timeoutMs);

    const stopMessages = transport.onMessage((data) => {
      try {
        const message = decodeMessage(data);
        if (!message) return;

        if (options.role === "host") {
          if (message.type !== "device-identity") return;

          const identity = decodeIdentity(message);
          transport.send(
            encodeMessage({
              protocolVersion: 1,
              type: "device-identity-ack",
              deviceId: identity.deviceId,
            }),
          );
          finish(() => resolve(identity));
          return;
        }

        if (message.type === "device-identity-request") {
          sendIdentity(options.identity, options.displayName);
          return;
        }

        if (
          message.type === "device-identity-ack" &&
          message.deviceId === options.identity.deviceId
        ) {
          finish(() =>
            resolve({
              ...cloneIdentity(options.identity),
              displayName: normalizeDisplayName(options.displayName),
            }),
          );
        }
      } catch (error: unknown) {
        fail(
          error instanceof Error
            ? error
            : new Error("Invalid device bootstrap message"),
        );
      }
    });

    const onAbort = () => fail(new Error("Device bootstrap aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    if (options.role === "host") {
      transport.send(
        encodeMessage({
          protocolVersion: 1,
          type: "device-identity-request",
        }),
      );
    } else {
      sendIdentity(options.identity);
    }

    function sendIdentity(
      identity: DevicePublicIdentity,
      displayName: string,
    ): void {
      transport.send(
        encodeMessage({
          protocolVersion: 1,
          type: "device-identity",
          deviceId: identity.deviceId,
          encryptionPublicKey: bytesToHex(identity.encryptionPublicKey),
          signingPublicKey: bytesToHex(identity.signingPublicKey),
          displayName: normalizeDisplayName(displayName),
        }),
      );
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

function encodeMessage(message: DeviceBootstrapMessage): Uint8Array {
  return textEncoder.encode(MESSAGE_PREFIX + JSON.stringify(message));
}

function decodeMessage(data: Uint8Array): DeviceBootstrapMessage | null {
  const text = textDecoder.decode(data);
  if (!text.startsWith(MESSAGE_PREFIX)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(MESSAGE_PREFIX.length));
  } catch {
    throw new Error("Invalid device bootstrap message");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("protocolVersion" in parsed) ||
    parsed.protocolVersion !== 1 ||
    !("type" in parsed) ||
    typeof parsed.type !== "string"
  ) {
    throw new Error("Invalid device bootstrap message");
  }

  switch (parsed.type) {
    case "device-identity-request":
      return {
        protocolVersion: 1,
        type: "device-identity-request",
      };

    case "device-identity":
      if (
        !("deviceId" in parsed) ||
        typeof parsed.deviceId !== "string" ||
        !("encryptionPublicKey" in parsed) ||
        typeof parsed.encryptionPublicKey !== "string" ||
        !("signingPublicKey" in parsed) ||
        typeof parsed.signingPublicKey !== "string" ||
        !("displayName" in parsed) ||
        typeof parsed.displayName !== "string"
      ) {
        throw new Error("Invalid device identity");
      }

      return {
        protocolVersion: 1,
        type: "device-identity",
        deviceId: parsed.deviceId,
        encryptionPublicKey: parsed.encryptionPublicKey,
        signingPublicKey: parsed.signingPublicKey,
        displayName: parsed.displayName,
      };

    case "device-identity-ack":
      if (!("deviceId" in parsed) || typeof parsed.deviceId !== "string") {
        throw new Error("Invalid device identity acknowledgement");
      }

      return {
        protocolVersion: 1,
        type: "device-identity-ack",
        deviceId: parsed.deviceId,
      };

    default:
      throw new Error("Unknown device bootstrap message");
  }
}

function decodeIdentity(
  message: Extract<DeviceBootstrapMessage, { type: "device-identity" }>,
): JoiningDeviceInfo {
  const encryptionPublicKey = hexToBytes(
    message.encryptionPublicKey,
    DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
    "device encryption public key",
  );
  const signingPublicKey = hexToBytes(
    message.signingPublicKey,
    DEVICE_SIGNING_PUBLIC_KEY_BYTES,
    "device signing public key",
  );

  return {
    deviceId: parseDeviceId(message.deviceId),
    encryptionPublicKey,
    signingPublicKey,
    displayName: normalizeDisplayName(message.displayName),
  };
}

function cloneIdentity(identity: DevicePublicIdentity): DevicePublicIdentity {
  return {
    deviceId: identity.deviceId,
    encryptionPublicKey: identity.encryptionPublicKey.slice(),
    signingPublicKey: identity.signingPublicKey.slice(),
  };
}

function hexToBytes(
  value: string,
  expectedBytes: number,
  name: string,
): Uint8Array {
  if (value.length !== expectedBytes * 2 || !HEX_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: expected ${expectedBytes} bytes of hexadecimal data`,
    );
  }

  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) throw new Error("Device name must not be empty");
  if (normalized.length > 80) {
    throw new Error("Device name must be 80 characters or fewer");
  }
  return normalized;
}
