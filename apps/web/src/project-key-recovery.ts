import { verifyEd25519Signature } from "@floe-note/crypto";
import type { DeviceId } from "@floe-note/domain";
import {
  encodeUnsignedWorkspaceKeyRotationEnvelope,
  type WorkspaceKeyRotationEnvelope,
  type SecurityState,
} from "@floe-note/security";
import type { DeviceVaultSession } from "@floe-note/vault";

type ProjectKeyStore = Pick<DeviceVaultSession, "storeSealedWorkspaceKey">;

export async function storeVerifiedRotatedProjectKey(
  session: ProjectKeyStore,
  state: SecurityState,
  localDeviceId: DeviceId,
  envelope: WorkspaceKeyRotationEnvelope,
): Promise<void> {
  if (
    envelope.workspaceId !== state.workspaceId ||
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
    encodeUnsignedWorkspaceKeyRotationEnvelope(envelope),
    envelope.signature,
    signer.signingPublicKey,
  );
  if (!verified) {
    throw new Error("ProjectKey rotation envelope signature verification failed");
  }

  await session.storeSealedWorkspaceKey(
    envelope.sealedEnvelope,
    envelope.workspaceId,
    envelope.keyEpoch,
    envelope.securityHead,
  );
}
