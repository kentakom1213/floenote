import { sha256, verifyEd25519Signature } from "@floe-note/crypto";
import {
  deriveAddDeviceSecurityState,
  deriveRevokeDeviceSecurityState,
  encodeAddDeviceTransition,
  encodeRevokeDeviceTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedRevokeDeviceTransition,
  type SecurityState,
  type SecurityTransition,
} from "@floe-note/security";

export async function applyVerifiedSecurityTransitions(
  initialState: SecurityState,
  transitions: readonly SecurityTransition[],
): Promise<SecurityState> {
  let state = initialState;

  for (const transition of transitions) {
    switch (transition.type) {
      case "add-device": {
        const signer = state.devices.find(
          (device) => device.deviceId === transition.signerDeviceId,
        );
        if (!signer) {
          throw new Error(
            `Security transition signer is not authorized at sequence ${transition.sequence}`,
          );
        }

        const signingBytes = encodeUnsignedAddDeviceTransition(transition);
        const verified = await verifyEd25519Signature(
          signingBytes,
          transition.signature,
          signer.signingPublicKey,
        );
        if (!verified) {
          throw new Error(
            `Security transition signature verification failed at sequence ${transition.sequence}`,
          );
        }

        const headHash = await sha256(encodeAddDeviceTransition(transition));
        state = deriveAddDeviceSecurityState(state, transition, headHash);
        break;
      }

      case "create-workspace":
        throw new Error(
          "CreateWorkspace cannot appear after an existing local SecurityState",
        );

      case "revoke-device": {
        const signer = state.devices.find(
          (device) => device.deviceId === transition.signerDeviceId,
        );
        if (!signer) {
          throw new Error(
            `Security transition signer is not authorized at sequence ${transition.sequence}`,
          );
        }

        const signingBytes = encodeUnsignedRevokeDeviceTransition(transition);
        const verified = await verifyEd25519Signature(
          signingBytes,
          transition.signature,
          signer.signingPublicKey,
        );
        if (!verified) {
          throw new Error(
            `Security transition signature verification failed at sequence ${transition.sequence}`,
          );
        }

        const headHash = await sha256(encodeRevokeDeviceTransition(transition));
        state = deriveRevokeDeviceSecurityState(state, transition, headHash);
        break;
      }
    }
  }

  return state;
}
