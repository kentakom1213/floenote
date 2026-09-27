import { sha256, verifyEd25519Signature } from "@floe-note/crypto";
import type { NoteProject } from "@floe-note/document";
import type { WorkspaceId } from "@floe-note/domain";
import {
  attachCreateWorkspaceSignature,
  createUnsignedCreateWorkspaceTransition,
  deriveInitialSecurityState,
  encodeCreateWorkspaceTransition,
  encodeUnsignedCreateWorkspaceTransition,
  type CreateWorkspaceTransition,
  type DevicePublicIdentity,
  type SecurityState,
} from "@floe-note/security";
import type {
  OpenProjectResult,
  ProjectStorageCrypto,
} from "@floe-note/storage";

import { securityStatesEqual } from "./security-reconciliation.js";

export type ProjectGenesisSession = ProjectStorageCrypto & {
  publicIdentity: DevicePublicIdentity;
  displayName: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
  createWorkspaceKeyIfMissing(
    projectId: WorkspaceId,
    keyEpoch: number,
  ): Promise<boolean>;
  hasWorkspaceKey(projectId: WorkspaceId, keyEpoch: number): boolean;
  removeWorkspaceKeys(projectId: WorkspaceId): Promise<void>;
};

export type ProjectGenesisCoordinator = {
  commitCreateWorkspace(
    projectId: WorkspaceId,
    transition: CreateWorkspaceTransition,
  ): Promise<SecurityState>;
};

export type ProjectGenesisStorage = {
  initializeCommittedProject(
    project: NoteProject,
    state: SecurityState,
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult>;
};

export type ProjectGenesisRuntime = {
  hash(bytes: Uint8Array): Promise<Uint8Array>;
  verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array,
  ): Promise<boolean>;
};

const defaultRuntime: ProjectGenesisRuntime = {
  hash: sha256,
  verify: verifyEd25519Signature,
};

export async function commitNewProjectGenesis(
  project: NoteProject,
  session: ProjectGenesisSession,
  coordinator: ProjectGenesisCoordinator,
  storage: ProjectGenesisStorage,
  runtime: ProjectGenesisRuntime = defaultRuntime,
): Promise<OpenProjectResult> {
  const identity = session.publicIdentity;
  project.setDeviceDisplayName(identity.deviceId, session.displayName);

  const unsignedTransition = createUnsignedCreateWorkspaceTransition(
    project.id,
    identity,
  );
  const signingBytes =
    encodeUnsignedCreateWorkspaceTransition(unsignedTransition);
  const signature = await session.sign(signingBytes);
  const transition = attachCreateWorkspaceSignature(
    unsignedTransition,
    signature,
  );

  const verified = await runtime.verify(
    signingBytes,
    transition.signature,
    transition.initialDevice.signingPublicKey,
  );
  if (!verified) {
    throw new Error("CreateWorkspace signature verification failed");
  }

  const headHash = await runtime.hash(
    encodeCreateWorkspaceTransition(transition),
  );
  const candidateState = deriveInitialSecurityState(
    transition,
    headHash,
  );
  const committedState = await coordinator.commitCreateWorkspace(
    project.id,
    transition,
  );

  if (!securityStatesEqual(candidateState, committedState)) {
    throw new Error(
      "Coordinator committed a SecurityState that does not match CreateWorkspace",
    );
  }

  const createdProjectKey = await session.createWorkspaceKeyIfMissing(
    project.id,
    committedState.keyEpoch,
  );
  if (!session.hasWorkspaceKey(project.id, committedState.keyEpoch)) {
    throw new Error("New ProjectKey is not available on this device");
  }

  try {
    return await storage.initializeCommittedProject(
      project,
      committedState,
      session,
    );
  } catch (error) {
    if (createdProjectKey) {
      try {
        await session.removeWorkspaceKeys(project.id);
      } catch {
        // The Project itself was not persisted. Preserve the original error;
        // a leftover key is safer than masking the failed local transaction.
      }
    }
    throw error;
  }
}
