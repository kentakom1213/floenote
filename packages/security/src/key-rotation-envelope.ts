import type { DeviceId, WorkspaceId } from "@floe-note/domain";
import { encode, rfc8949EncodeOptions } from "cborg";

import { SECURITY_HEAD_HASH_BYTES, SECURITY_SIGNATURE_BYTES } from "./create-workspace.js";
import { SECURITY_PROTOCOL_VERSION } from "./state.js";

export type UnsignedWorkspaceKeyRotationEnvelope = {
  protocolVersion: 1;
  workspaceId: WorkspaceId;
  keyEpoch: number;
  securityHead: Uint8Array;
  recipientDeviceId: DeviceId;
  sealedEnvelope: Uint8Array;
  signerDeviceId: DeviceId;
};

export type WorkspaceKeyRotationEnvelope =
  UnsignedWorkspaceKeyRotationEnvelope & {
    signature: Uint8Array;
  };

export function encodeUnsignedWorkspaceKeyRotationEnvelope(
  envelope: UnsignedWorkspaceKeyRotationEnvelope,
): Uint8Array {
  validateUnsignedEnvelope(envelope);
  return encode(
    {
      protocolVersion: SECURITY_PROTOCOL_VERSION,
      workspaceId: envelope.workspaceId,
      keyEpoch: envelope.keyEpoch,
      securityHead: envelope.securityHead,
      recipientDeviceId: envelope.recipientDeviceId,
      sealedEnvelope: envelope.sealedEnvelope,
      signerDeviceId: envelope.signerDeviceId,
    },
    rfc8949EncodeOptions,
  );
}

export function attachWorkspaceKeyRotationEnvelopeSignature(
  envelope: UnsignedWorkspaceKeyRotationEnvelope,
  signature: Uint8Array,
): WorkspaceKeyRotationEnvelope {
  validateUnsignedEnvelope(envelope);
  if (signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `WorkspaceKey rotation envelope signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
    );
  }

  return {
    ...envelope,
    securityHead: envelope.securityHead.slice(),
    sealedEnvelope: envelope.sealedEnvelope.slice(),
    signature: signature.slice(),
  };
}

function validateUnsignedEnvelope(
  envelope: UnsignedWorkspaceKeyRotationEnvelope,
): void {
  if (
    envelope.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    !Number.isSafeInteger(envelope.keyEpoch) ||
    envelope.keyEpoch < 2 ||
    envelope.securityHead.byteLength !== SECURITY_HEAD_HASH_BYTES ||
    envelope.sealedEnvelope.byteLength === 0
  ) {
    throw new TypeError("Invalid WorkspaceKey rotation envelope");
  }
}
