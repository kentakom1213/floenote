import { sha256, verifyEd25519Signature } from "@floe-note/crypto";
import type { NoteProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";
import {
  attachCreateProjectSignature,
  createUnsignedCreateProjectTransition,
  deriveInitialSecurityState,
  encodeCreateProjectTransition,
  encodeUnsignedCreateProjectTransition,
  type CreateProjectTransition,
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
  createProjectKeyIfMissing(
    projectId: ProjectId,
    keyEpoch: number,
  ): Promise<boolean>;
  hasProjectKey(projectId: ProjectId, keyEpoch: number): boolean;
  removeProjectKeys(projectId: ProjectId): Promise<void>;
};

export type ProjectGenesisCoordinator = {
  commitCreateProject(
    projectId: ProjectId,
    transition: CreateProjectTransition,
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

  const unsignedTransition = createUnsignedCreateProjectTransition(
    project.id,
    identity,
  );
  const signingBytes =
    encodeUnsignedCreateProjectTransition(unsignedTransition);
  const signature = await session.sign(signingBytes);
  const transition = attachCreateProjectSignature(
    unsignedTransition,
    signature,
  );

  const verified = await runtime.verify(
    signingBytes,
    transition.signature,
    transition.initialDevice.signingPublicKey,
  );
  if (!verified) {
    throw new Error("CreateProject signature verification failed");
  }

  const headHash = await runtime.hash(
    encodeCreateProjectTransition(transition),
  );
  const candidateState = deriveInitialSecurityState(
    transition,
    headHash,
  );
  const committedState = await coordinator.commitCreateProject(
    project.id,
    transition,
  );

  if (!securityStatesEqual(candidateState, committedState)) {
    throw new Error(
      "Coordinator committed a SecurityState that does not match CreateProject",
    );
  }

  const createdProjectKey = await session.createProjectKeyIfMissing(
    project.id,
    committedState.keyEpoch,
  );
  if (!session.hasProjectKey(project.id, committedState.keyEpoch)) {
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
        await session.removeProjectKeys(project.id);
      } catch {
        // The Project itself was not persisted. Preserve the original error;
        // a leftover key is safer than masking the failed local transaction.
      }
    }
    throw error;
  }
}
