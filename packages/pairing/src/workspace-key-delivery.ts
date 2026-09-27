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

const MESSAGE_PREFIX = "floe-note:workspace-key-delivery:v1:";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SEALED_ENVELOPE_BYTES = 4 * 1024;

type WorkspaceKeyDeliveryMessage = {
  protocolVersion: 1;
  type: "workspace-key-delivery";
  workspaceId: string;
  keyEpoch: number;
  recipientDeviceId: string;
  securityHead: string;
  securityState: SecurityStateWirePayload;
  sealedEnvelope: string;
};

type WorkspaceKeyStoredMessage = {
  protocolVersion: 1;
  type: "workspace-key-stored";
  workspaceId: string;
  keyEpoch: number;
  recipientDeviceId: string;
  securityHead: string;
};

type WorkspaceKeyMessage =
  | WorkspaceKeyDeliveryMessage
  | WorkspaceKeyStoredMessage;

export type WorkspaceKeyDelivery = {
  securityState: SecurityState;
  sealedEnvelope: Uint8Array;
};

export type SendWorkspaceKeyDeliveryOptions = {
  transport: Transport;
  securityState: SecurityState;
  recipientDeviceId: DeviceId;
  sealedEnvelope: Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ReceiveWorkspaceKeyDeliveryOptions = {
  transport: Transport;
  workspaceId: WorkspaceId;
  recipientIdentity: DevicePublicIdentity;
  onDelivery: (delivery: WorkspaceKeyDelivery) => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function sendWorkspaceKeyDelivery(
  options: SendWorkspaceKeyDeliveryOptions,
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
    throw new Error("WorkspaceKey delivery aborted");
  }
  if (
    sealedEnvelope.byteLength === 0 ||
    sealedEnvelope.byteLength > MAX_SEALED_ENVELOPE_BYTES
  ) {
    throw new Error("Invalid sealed WorkspaceKey envelope size");
  }

  const recipient = securityState.devices.find(
    (device) => device.deviceId === recipientDeviceId,
  );
  if (!recipient) {
    throw new Error("WorkspaceKey recipient is not authorized");
  }

  const securityHead = bytesToHex(securityState.headHash);
  const message: WorkspaceKeyDeliveryMessage = {
    protocolVersion: 1,
    type: "workspace-key-delivery",
    workspaceId: securityState.workspaceId,
    keyEpoch: securityState.keyEpoch,
    recipientDeviceId,
    securityHead,
    securityState: securityStateToWire(securityState),
    sealedEnvelope: bytesToHex(sealedEnvelope),
  };

  await new Promise<void>((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      fail(new Error("WorkspaceKey delivery acknowledgement timed out"));
    }, timeoutMs);

    const stopMessages = transport.onMessage((data) => {
      try {
        const received = decodeMessage(data);
        if (!received || received.type !== "workspace-key-stored") return;

        if (
          received.workspaceId !== securityState.workspaceId ||
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
            : new Error("Invalid WorkspaceKey acknowledgement"),
        );
      }
    });

    const onAbort = () => fail(new Error("WorkspaceKey delivery aborted"));
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

export async function receiveWorkspaceKeyDelivery(
  options: ReceiveWorkspaceKeyDeliveryOptions,
): Promise<SecurityState> {
  const {
    transport,
    workspaceId,
    recipientIdentity,
    onDelivery,
    signal,
  } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (signal?.aborted) {
    throw new Error("WorkspaceKey delivery aborted");
  }

  return new Promise<SecurityState>((resolve, reject) => {
    let finished = false;
    let handling = false;

    const timeout = setTimeout(() => {
      fail(new Error("WorkspaceKey delivery timed out"));
    }, timeoutMs);

    const stopMessages = transport.onMessage((data) => {
      if (handling || finished) return;

      let message: WorkspaceKeyMessage | null;
      try {
        message = decodeMessage(data);
      } catch (error: unknown) {
        fail(
          error instanceof Error
            ? error
            : new Error("Invalid WorkspaceKey delivery"),
        );
        return;
      }

      if (!message || message.type !== "workspace-key-delivery") return;
      handling = true;

      void handleDelivery(message).catch((error: unknown) => {
        fail(
          error instanceof Error
            ? error
            : new Error("Could not store delivered WorkspaceKey"),
        );
      });
    });

    const onAbort = () => fail(new Error("WorkspaceKey delivery aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    async function handleDelivery(
      message: WorkspaceKeyDeliveryMessage,
    ): Promise<void> {
      if (
        message.workspaceId !== workspaceId ||
        message.recipientDeviceId !== recipientIdentity.deviceId
      ) {
        throw new Error("WorkspaceKey delivery does not target this device");
      }

      const securityState = parseSecurityStateWirePayload(
        message.securityState,
        workspaceId,
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
        throw new Error("WorkspaceKey delivery SecurityState does not match");
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
        "sealed WorkspaceKey envelope",
      );
      if (sealedEnvelope.byteLength > MAX_SEALED_ENVELOPE_BYTES) {
        throw new Error("Sealed WorkspaceKey envelope is too large");
      }

      await onDelivery({
        securityState,
        sealedEnvelope,
      });

      transport.send(
        encodeMessage({
          protocolVersion: 1,
          type: "workspace-key-stored",
          workspaceId,
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

function encodeMessage(message: WorkspaceKeyMessage): Uint8Array {
  return new TextEncoder().encode(MESSAGE_PREFIX + JSON.stringify(message));
}

function decodeMessage(data: Uint8Array): WorkspaceKeyMessage | null {
  if (data.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error("WorkspaceKey delivery message is too large");
  }

  const text = new TextDecoder().decode(data);
  if (!text.startsWith(MESSAGE_PREFIX)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(MESSAGE_PREFIX.length));
  } catch {
    throw new Error("Invalid WorkspaceKey delivery message");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("protocolVersion" in parsed) ||
    parsed.protocolVersion !== 1 ||
    !("type" in parsed) ||
    typeof parsed.type !== "string" ||
    !("workspaceId" in parsed) ||
    typeof parsed.workspaceId !== "string" ||
    !("keyEpoch" in parsed) ||
    typeof parsed.keyEpoch !== "number" ||
    !Number.isSafeInteger(parsed.keyEpoch) ||
    parsed.keyEpoch < 1 ||
    !("recipientDeviceId" in parsed) ||
    typeof parsed.recipientDeviceId !== "string" ||
    !("securityHead" in parsed) ||
    typeof parsed.securityHead !== "string"
  ) {
    throw new Error("Invalid WorkspaceKey delivery message");
  }

  if (parsed.type === "workspace-key-stored") {
    return {
      protocolVersion: 1,
      type: "workspace-key-stored",
      workspaceId: parsed.workspaceId,
      keyEpoch: parsed.keyEpoch,
      recipientDeviceId: parsed.recipientDeviceId,
      securityHead: parsed.securityHead,
    };
  }

  if (
    parsed.type === "workspace-key-delivery" &&
    "securityState" in parsed &&
    typeof parsed.securityState === "object" &&
    parsed.securityState !== null &&
    "sealedEnvelope" in parsed &&
    typeof parsed.sealedEnvelope === "string"
  ) {
    return {
      protocolVersion: 1,
      type: "workspace-key-delivery",
      workspaceId: parsed.workspaceId,
      keyEpoch: parsed.keyEpoch,
      recipientDeviceId: parsed.recipientDeviceId,
      securityHead: parsed.securityHead,
      securityState: parsed.securityState as SecurityStateWirePayload,
      sealedEnvelope: parsed.sealedEnvelope,
    };
  }

  throw new Error("Unknown WorkspaceKey delivery message");
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
