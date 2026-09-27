import { SHA256_BYTES } from "@floe-note/crypto";
import type { DeviceId, WorkspaceId } from "@floe-note/domain";
import {
  parseSecurityStateWirePayload,
  securityStateToWire,
  type DevicePublicIdentity,
  type SecurityState,
  type SecurityStateWirePayload,
} from "@floe-note/security";
import type { Transport } from "@floe-note/transport";

const MESSAGE_PREFIX = "floe-note:project-key-delivery:v1:";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SEALED_ENVELOPE_BYTES = 4 * 1024;

type ProjectKeyDeliveryMessage = {
  protocolVersion: 1;
  type: "project-key-delivery";
  projectId: string;
  keyEpoch: number;
  recipientDeviceId: string;
  securityHead: string;
  securityState: SecurityStateWirePayload;
  sealedEnvelope: string;
};

type ProjectKeyStoredMessage = {
  protocolVersion: 1;
  type: "project-key-stored";
  projectId: string;
  keyEpoch: number;
  recipientDeviceId: string;
  securityHead: string;
};

type ProjectKeyMessage =
  | ProjectKeyDeliveryMessage
  | ProjectKeyStoredMessage;

export type ProjectKeyDelivery = {
  securityState: SecurityState;
  sealedEnvelope: Uint8Array;
};

export type SendProjectKeyDeliveryOptions = {
  transport: Transport;
  securityState: SecurityState;
  recipientDeviceId: DeviceId;
  sealedEnvelope: Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ReceiveProjectKeyDeliveryOptions = {
  transport: Transport;
  projectId: WorkspaceId;
  recipientIdentity: DevicePublicIdentity;
  onDelivery: (delivery: ProjectKeyDelivery) => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function sendProjectKeyDelivery(
  options: SendProjectKeyDeliveryOptions,
): Promise<void> {
  const {
    transport,
    securityState,
    recipientDeviceId,
    sealedEnvelope,
    signal,
  } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (signal?.aborted) {
    throw new Error("ProjectKey delivery aborted");
  }
  if (
    sealedEnvelope.byteLength === 0 ||
    sealedEnvelope.byteLength > MAX_SEALED_ENVELOPE_BYTES
  ) {
    throw new Error("Invalid sealed ProjectKey envelope size");
  }

  const recipient = securityState.devices.find(
    (device) => device.deviceId === recipientDeviceId,
  );
  if (!recipient) {
    throw new Error("ProjectKey recipient is not authorized");
  }

  const securityHead = bytesToHex(securityState.headHash);
  const message: ProjectKeyDeliveryMessage = {
    protocolVersion: 1,
    type: "project-key-delivery",
    projectId: securityState.workspaceId,
    keyEpoch: securityState.keyEpoch,
    recipientDeviceId,
    securityHead,
    securityState: securityStateToWire(securityState),
    sealedEnvelope: bytesToHex(sealedEnvelope),
  };

  await new Promise<void>((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      fail(new Error("ProjectKey delivery acknowledgement timed out"));
    }, timeoutMs);

    const stopMessages = transport.onMessage((data) => {
      try {
        const received = decodeMessage(data);
        if (!received || received.type !== "project-key-stored") return;

        if (
          received.projectId !== securityState.workspaceId ||
          received.keyEpoch !== securityState.keyEpoch ||
          received.recipientDeviceId !== recipientDeviceId ||
          received.securityHead !== securityHead
        ) {
          return;
        }

        finish(resolve);
      } catch (error: unknown) {
        fail(
          error instanceof Error
            ? error
            : new Error("Invalid ProjectKey acknowledgement"),
        );
      }
    });

    const onAbort = () => fail(new Error("ProjectKey delivery aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    transport.send(encodeMessage(message));

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

export async function receiveProjectKeyDelivery(
  options: ReceiveProjectKeyDeliveryOptions,
): Promise<SecurityState> {
  const {
    transport,
    projectId,
    recipientIdentity,
    onDelivery,
    signal,
  } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (signal?.aborted) {
    throw new Error("ProjectKey delivery aborted");
  }

  return new Promise<SecurityState>((resolve, reject) => {
    let finished = false;
    let handling = false;

    const timeout = setTimeout(() => {
      fail(new Error("ProjectKey delivery timed out"));
    }, timeoutMs);

    const stopMessages = transport.onMessage((data) => {
      if (handling || finished) return;

      let message: ProjectKeyMessage | null;
      try {
        message = decodeMessage(data);
      } catch (error: unknown) {
        fail(
          error instanceof Error
            ? error
            : new Error("Invalid ProjectKey delivery"),
        );
        return;
      }

      if (!message || message.type !== "project-key-delivery") return;
      handling = true;

      void handleDelivery(message).catch((error: unknown) => {
        fail(
          error instanceof Error
            ? error
            : new Error("Could not store delivered ProjectKey"),
        );
      });
    });

    const onAbort = () => fail(new Error("ProjectKey delivery aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    async function handleDelivery(
      message: ProjectKeyDeliveryMessage,
    ): Promise<void> {
      if (
        message.projectId !== projectId ||
        message.recipientDeviceId !== recipientIdentity.deviceId
      ) {
        throw new Error("ProjectKey delivery does not target this device");
      }

      const securityState = parseSecurityStateWirePayload(
        message.securityState,
        projectId,
      );
      const securityHead = hexToBytes(
        message.securityHead,
        SHA256_BYTES,
        "security head",
      );

      if (
        securityState.keyEpoch !== message.keyEpoch ||
        !bytesEqual(securityState.headHash, securityHead)
      ) {
        throw new Error("ProjectKey delivery SecurityState does not match");
      }

      const authorizedRecipient = securityState.devices.find(
        (device) => device.deviceId === recipientIdentity.deviceId,
      );
      if (
        !authorizedRecipient ||
        !bytesEqual(
          authorizedRecipient.encryptionPublicKey,
          recipientIdentity.encryptionPublicKey,
        ) ||
        !bytesEqual(
          authorizedRecipient.signingPublicKey,
          recipientIdentity.signingPublicKey,
        )
      ) {
        throw new Error(
          "Committed SecurityState does not authorize this Device Vault identity",
        );
      }

      const sealedEnvelope = hexToBytes(
        message.sealedEnvelope,
        null,
        "sealed ProjectKey envelope",
      );
      if (sealedEnvelope.byteLength > MAX_SEALED_ENVELOPE_BYTES) {
        throw new Error("Sealed ProjectKey envelope is too large");
      }

      await onDelivery({
        securityState,
        sealedEnvelope,
      });

      transport.send(
        encodeMessage({
          protocolVersion: 1,
          type: "project-key-stored",
          projectId,
          keyEpoch: securityState.keyEpoch,
          recipientDeviceId: recipientIdentity.deviceId,
          securityHead: message.securityHead,
        }),
      );

      finish(() => resolve(securityState));
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

function encodeMessage(message: ProjectKeyMessage): Uint8Array {
  return new TextEncoder().encode(MESSAGE_PREFIX + JSON.stringify(message));
}

function decodeMessage(data: Uint8Array): ProjectKeyMessage | null {
  if (data.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error("ProjectKey delivery message is too large");
  }

  const text = new TextDecoder().decode(data);
  if (!text.startsWith(MESSAGE_PREFIX)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(MESSAGE_PREFIX.length));
  } catch {
    throw new Error("Invalid ProjectKey delivery message");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("protocolVersion" in parsed) ||
    parsed.protocolVersion !== 1 ||
    !("type" in parsed) ||
    typeof parsed.type !== "string" ||
    !("projectId" in parsed) ||
    typeof parsed.projectId !== "string" ||
    !("keyEpoch" in parsed) ||
    typeof parsed.keyEpoch !== "number" ||
    !Number.isSafeInteger(parsed.keyEpoch) ||
    parsed.keyEpoch < 1 ||
    !("recipientDeviceId" in parsed) ||
    typeof parsed.recipientDeviceId !== "string" ||
    !("securityHead" in parsed) ||
    typeof parsed.securityHead !== "string"
  ) {
    throw new Error("Invalid ProjectKey delivery message");
  }

  if (parsed.type === "project-key-stored") {
    return {
      protocolVersion: 1,
      type: "project-key-stored",
      projectId: parsed.projectId,
      keyEpoch: parsed.keyEpoch,
      recipientDeviceId: parsed.recipientDeviceId,
      securityHead: parsed.securityHead,
    };
  }

  if (
    parsed.type === "project-key-delivery" &&
    "securityState" in parsed &&
    typeof parsed.securityState === "object" &&
    parsed.securityState !== null &&
    "sealedEnvelope" in parsed &&
    typeof parsed.sealedEnvelope === "string"
  ) {
    return {
      protocolVersion: 1,
      type: "project-key-delivery",
      projectId: parsed.projectId,
      keyEpoch: parsed.keyEpoch,
      recipientDeviceId: parsed.recipientDeviceId,
      securityHead: parsed.securityHead,
      securityState: parsed.securityState as SecurityStateWirePayload,
      sealedEnvelope: parsed.sealedEnvelope,
    };
  }

  throw new Error("Unknown ProjectKey delivery message");
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
    !/^[0-9a-f]+$/u.test(value) ||
    (expectedBytes !== null && value.length !== expectedBytes * 2)
  ) {
    throw new Error(`Invalid ${label}`);
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
