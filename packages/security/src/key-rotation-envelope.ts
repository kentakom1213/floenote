import type { DeviceId, ProjectId } from "@floe-note/domain";
import { encode, rfc8949EncodeOptions } from "cborg";

import { SECURITY_HEAD_HASH_BYTES, SECURITY_SIGNATURE_BYTES } from "./create-project.js";
import { SECURITY_PROTOCOL_VERSION } from "./state.js";

export type UnsignedProjectKeyRotationEnvelope = {
  protocolVersion: 1;
  projectId: ProjectId;
  keyEpoch: number;
  securityHead: Uint8Array;
  recipientDeviceId: DeviceId;
  sealedEnvelope: Uint8Array;
  signerDeviceId: DeviceId;
};

export type ProjectKeyRotationEnvelope =
  UnsignedProjectKeyRotationEnvelope & {
    signature: Uint8Array;
  };

export function encodeUnsignedProjectKeyRotationEnvelope(
  envelope: UnsignedProjectKeyRotationEnvelope,
): Uint8Array {
  validateUnsignedEnvelope(envelope);
  return encode(
    {
      protocolVersion: SECURITY_PROTOCOL_VERSION,
      projectId: envelope.projectId,
      keyEpoch: envelope.keyEpoch,
      securityHead: envelope.securityHead,
      recipientDeviceId: envelope.recipientDeviceId,
      sealedEnvelope: envelope.sealedEnvelope,
      signerDeviceId: envelope.signerDeviceId,
    },
    rfc8949EncodeOptions,
  );
}

export function attachProjectKeyRotationEnvelopeSignature(
  envelope: UnsignedProjectKeyRotationEnvelope,
  signature: Uint8Array,
): ProjectKeyRotationEnvelope {
  validateUnsignedEnvelope(envelope);
  if (signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `ProjectKey rotation envelope signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
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
  envelope: UnsignedProjectKeyRotationEnvelope,
): void {
  if (
    envelope.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    !Number.isSafeInteger(envelope.keyEpoch) ||
    envelope.keyEpoch < 2 ||
    envelope.securityHead.byteLength !== SECURITY_HEAD_HASH_BYTES ||
    envelope.sealedEnvelope.byteLength === 0
  ) {
    throw new TypeError("Invalid ProjectKey rotation envelope");
  }
}
