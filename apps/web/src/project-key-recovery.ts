import { verifyEd25519Signature } from "@floe-note/crypto";
import type { DeviceId } from "@floe-note/domain";
import {
  encodeUnsignedProjectKeyRotationEnvelope,
  type ProjectKeyRotationEnvelope,
  type SecurityState,
} from "@floe-note/security";
import type { DeviceVaultSession } from "@floe-note/vault";

type ProjectKeyStore = Pick<DeviceVaultSession, "storeSealedProjectKey">;

export async function storeVerifiedRotatedProjectKey(
  session: ProjectKeyStore,
  state: SecurityState,
  localDeviceId: DeviceId,
  envelope: ProjectKeyRotationEnvelope,
): Promise<void> {
  if (
    envelope.projectId !== state.projectId ||
    envelope.keyEpoch !== state.keyEpoch ||
    envelope.recipientDeviceId !== localDeviceId
  ) {
    throw new Error("ProjectKey rotation envelope does not match SecurityState");
  }

  const signer = state.devices.find(
    (device) => device.deviceId === envelope.signerDeviceId,
  );
  if (!signer) {
    throw new Error("ProjectKey rotation envelope signer is not authorized");
  }

  const verified = await verifyEd25519Signature(
    encodeUnsignedProjectKeyRotationEnvelope(envelope),
    envelope.signature,
    signer.signingPublicKey,
  );
  if (!verified) {
    throw new Error("ProjectKey rotation envelope signature verification failed");
  }

  await session.storeSealedProjectKey(
    envelope.sealedEnvelope,
    envelope.projectId,
    envelope.keyEpoch,
    envelope.securityHead,
  );
}
