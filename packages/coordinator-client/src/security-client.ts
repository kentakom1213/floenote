import {
  parseDeviceId,
  parseWorkspaceId,
  type DeviceId,
  type WorkspaceId,
} from "@floe-note/domain";
import {
  addDeviceTransitionToWire,
  createWorkspaceTransitionToWire,
  parseSecurityStateWirePayload,
  parseSecurityTransitionWirePayload,
  revokeDeviceTransitionToWire,
  type AddDeviceTransition,
  type CreateWorkspaceTransition,
  type WorkspaceKeyRotationEnvelope,
  type RevokeDeviceTransition,
  type SecurityState,
  type SecurityTransition,
} from "@floe-note/security";

export class SecurityCoordinatorClient {
  readonly #baseUrl: URL;

  constructor(coordinatorBaseUrl: string) {
    this.#baseUrl = new URL(coordinatorBaseUrl);
  }

  async getSecurityState(
    projectId: WorkspaceId,
  ): Promise<SecurityState> {
    const response = await fetch(
      new URL(
        `/projects/${encodeURIComponent(projectId)}/security`,
        this.#baseUrl,
      ),
    );

    await ensureOk(response);
    const responsePayload = (await response.json()) as unknown;
    return parseSecurityStateWirePayload(responsePayload, projectId);
  }

  async getSecurityTransitions(
    projectId: WorkspaceId,
    afterSequence: number,
  ): Promise<readonly SecurityTransition[]> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new TypeError("afterSequence must be a non-negative safe integer");
    }

    const url = new URL(
      `/projects/${encodeURIComponent(projectId)}/security/transitions`,
      this.#baseUrl,
    );
    url.searchParams.set("after", String(afterSequence));

    const response = await fetch(url);
    await ensureOk(response);

    const payload = (await response.json()) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("fromSequence" in payload) ||
      payload.fromSequence !== afterSequence ||
      !("toSequence" in payload) ||
      typeof payload.toSequence !== "number" ||
      !Number.isSafeInteger(payload.toSequence) ||
      payload.toSequence < afterSequence ||
      !("transitions" in payload) ||
      !Array.isArray(payload.transitions)
    ) {
      throw new TypeError("Invalid SecurityTransition catch-up response");
    }

    const transitions = payload.transitions.map((transition) =>
      parseSecurityTransitionWirePayload(transition, projectId),
    );

    if (transitions.length !== payload.toSequence - afterSequence) {
      throw new TypeError("SecurityTransition catch-up response has a gap");
    }

    for (let index = 0; index < transitions.length; index += 1) {
      if (transitions[index]?.sequence !== afterSequence + index + 1) {
        throw new TypeError("SecurityTransition sequence is not contiguous");
      }
    }

    return transitions;
  }

  async commitAddDevice(
    projectId: WorkspaceId,
    transition: AddDeviceTransition,
  ): Promise<SecurityState> {
    return this.#commitTransition(
      projectId,
      addDeviceTransitionToWire(transition),
    );
  }

  async commitRevokeDevice(
    projectId: WorkspaceId,
    transition: RevokeDeviceTransition,
    keyEnvelopes: readonly WorkspaceKeyRotationEnvelope[],
  ): Promise<SecurityState> {
    return this.#commitTransition(projectId, {
      ...revokeDeviceTransitionToWire(transition),
      keyEnvelopes: keyEnvelopes.map((envelope) => ({
        protocolVersion: envelope.protocolVersion,
        projectId: envelope.workspaceId,
        keyEpoch: envelope.keyEpoch,
        securityHead: bytesToHex(envelope.securityHead),
        recipientDeviceId: envelope.recipientDeviceId,
        sealedEnvelope: bytesToHex(envelope.sealedEnvelope),
        signerDeviceId: envelope.signerDeviceId,
        signature: bytesToHex(envelope.signature),
      })),
    });
  }

  async getProjectKeyEnvelope(
    projectId: WorkspaceId,
    keyEpoch: number,
    recipientDeviceId: DeviceId,
  ): Promise<WorkspaceKeyRotationEnvelope> {
    if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) {
      throw new TypeError("keyEpoch must be a positive safe integer");
    }

    const response = await fetch(
      new URL(
        `/projects/${encodeURIComponent(projectId)}/project-keys/${keyEpoch}/${encodeURIComponent(recipientDeviceId)}`,
        this.#baseUrl,
      ),
    );
    await ensureOk(response);

    const payload = (await response.json()) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("protocolVersion" in payload) ||
      payload.protocolVersion !== 1 ||
      !("projectId" in payload) ||
      typeof payload.projectId !== "string" ||
      !("keyEpoch" in payload) ||
      payload.keyEpoch !== keyEpoch ||
      !("securityHead" in payload) ||
      typeof payload.securityHead !== "string" ||
      !("recipientDeviceId" in payload) ||
      typeof payload.recipientDeviceId !== "string" ||
      payload.recipientDeviceId !== recipientDeviceId ||
      !("sealedEnvelope" in payload) ||
      typeof payload.sealedEnvelope !== "string" ||
      !("signerDeviceId" in payload) ||
      typeof payload.signerDeviceId !== "string" ||
      !("signature" in payload) ||
      typeof payload.signature !== "string"
    ) {
      throw new TypeError("Invalid ProjectKey envelope response");
    }

    const parsedWorkspaceId = parseWorkspaceId(payload.projectId);
    if (parsedWorkspaceId !== projectId) {
      throw new TypeError("ProjectKey envelope WorkspaceId does not match request");
    }

    return {
      protocolVersion: 1,
      workspaceId: parsedWorkspaceId,
      keyEpoch,
      securityHead: hexToBytes(payload.securityHead),
      recipientDeviceId: parseDeviceId(payload.recipientDeviceId),
      sealedEnvelope: hexToBytes(payload.sealedEnvelope),
      signerDeviceId: parseDeviceId(payload.signerDeviceId),
      signature: hexToBytes(payload.signature),
    };
  }

  async commitCreateWorkspace(
    projectId: WorkspaceId,
    transition: CreateWorkspaceTransition,
  ): Promise<SecurityState> {
    return this.#commitTransition(
      projectId,
      createWorkspaceTransitionToWire(transition),
    );
  }

  async #commitTransition(
    projectId: WorkspaceId,
    payload: unknown,
  ): Promise<SecurityState> {
    const response = await fetch(
      new URL(
        `/projects/${encodeURIComponent(projectId)}/security/transitions`,
        this.#baseUrl,
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    await ensureOk(response);
    const responsePayload = (await response.json()) as unknown;
    return parseSecurityStateWirePayload(responsePayload, projectId);
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;

  const detail = (await response.text()).trim();
  throw new Error(
    detail === ""
      ? `Coordinator request failed with HTTP ${response.status}`
      : detail,
  );
}


function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/u.test(value)
  ) {
    throw new TypeError("Invalid ProjectKey envelope encoding");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
