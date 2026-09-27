import type { WorkspaceId } from "@floe-note/domain";
import type {
  SecurityState,
  SecurityTransition,
} from "@floe-note/security";

import { applyVerifiedSecurityTransitions } from "./security-catch-up.js";

export type SecurityStateCoordinatorReader = {
  getSecurityState(projectId: WorkspaceId): Promise<SecurityState>;
  getSecurityTransitions(
    projectId: WorkspaceId,
    afterSequence: number,
  ): Promise<readonly SecurityTransition[]>;
};

export async function reconcileVerifiedSecurityState(
  coordinator: SecurityStateCoordinatorReader,
  storedState: SecurityState,
): Promise<SecurityState> {
  const coordinatorState = await coordinator.getSecurityState(
    storedState.projectId,
  );

  if (coordinatorState.sequence < storedState.sequence) {
    throw new Error(
      "Coordinator SecurityState is older than the locally verified state",
    );
  }

  let verifiedState = storedState;

  if (coordinatorState.sequence > storedState.sequence) {
    const transitions = await coordinator.getSecurityTransitions(
      storedState.projectId,
      storedState.sequence,
    );
    verifiedState = await applyVerifiedSecurityTransitions(
      storedState,
      transitions,
    );
  }

  if (!securityStatesEqual(verifiedState, coordinatorState)) {
    throw new Error(
      "Verified SecurityState does not match the coordinator current state",
    );
  }

  return verifiedState;
}

export function securityStatesEqual(
  left: SecurityState,
  right: SecurityState,
): boolean {
  if (
    left.protocolVersion !== right.protocolVersion ||
    left.projectId !== right.projectId ||
    left.sequence !== right.sequence ||
    left.keyEpoch !== right.keyEpoch ||
    !bytesEqual(left.headHash, right.headHash) ||
    left.devices.length !== right.devices.length
  ) {
    return false;
  }

  return left.devices.every((device, index) => {
    const other = right.devices[index];
    return (
      other !== undefined &&
      device.deviceId === other.deviceId &&
      device.addedAtSequence === other.addedAtSequence &&
      bytesEqual(device.encryptionPublicKey, other.encryptionPublicKey) &&
      bytesEqual(device.signingPublicKey, other.signingPublicKey)
    );
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
