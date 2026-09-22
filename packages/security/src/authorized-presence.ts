import type { DeviceId, ProjectId } from "@floe-note/domain";
import { encode, rfc8949EncodeOptions } from "cborg";

import {
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_SIGNATURE_BYTES,
} from "./create-project.js";
import { SECURITY_PROTOCOL_VERSION } from "./state.js";

export const AUTHORIZED_PRESENCE_CHALLENGE_BYTES = 32;

export type AuthorizedPresenceProof = {
  protocolVersion: typeof SECURITY_PROTOCOL_VERSION;
  projectId: ProjectId;
  deviceId: DeviceId;
  securityHead: Uint8Array;
  challenge: Uint8Array;
};

export function encodeAuthorizedPresenceProof(
  proof: AuthorizedPresenceProof,
): Uint8Array {
  if (proof.protocolVersion !== SECURITY_PROTOCOL_VERSION) {
    throw new TypeError("Unsupported authorized-presence protocol version");
  }
  if (proof.securityHead.byteLength !== SECURITY_HEAD_HASH_BYTES) {
    throw new TypeError(
      `Security head hash must be ${SECURITY_HEAD_HASH_BYTES} bytes`,
    );
  }
  if (proof.challenge.byteLength !== AUTHORIZED_PRESENCE_CHALLENGE_BYTES) {
    throw new TypeError(
      `Presence challenge must be ${AUTHORIZED_PRESENCE_CHALLENGE_BYTES} bytes`,
    );
  }

  return encode(
    {
      type: "authorized-presence",
      protocolVersion: proof.protocolVersion,
      projectId: proof.projectId,
      deviceId: proof.deviceId,
      securityHead: proof.securityHead,
      challenge: proof.challenge,
    },
    rfc8949EncodeOptions,
  );
}

export function assertAuthorizedPresenceSignature(
  signature: Uint8Array,
): void {
  if (signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `Authorized-presence signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
    );
  }
}
