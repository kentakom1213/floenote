import type { ProjectId } from "@floe-note/domain";
import {
  addDeviceTransitionToWire,
  createProjectTransitionToWire,
  parseSecurityStateWirePayload,
  parseSecurityTransitionWirePayload,
  type AddDeviceTransition,
  type CreateProjectTransition,
  type SecurityState,
  type SecurityTransition,
} from "@floe-note/security";

export class SecurityCoordinatorClient {
  readonly #baseUrl: URL;

  constructor(coordinatorBaseUrl: string) {
    this.#baseUrl = new URL(coordinatorBaseUrl);
  }

  async getSecurityState(
    projectId: ProjectId,
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
    projectId: ProjectId,
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
    projectId: ProjectId,
    transition: AddDeviceTransition,
  ): Promise<SecurityState> {
    return this.#commitTransition(
      projectId,
      addDeviceTransitionToWire(transition),
    );
  }

  async commitCreateProject(
    projectId: ProjectId,
    transition: CreateProjectTransition,
  ): Promise<SecurityState> {
    return this.#commitTransition(
      projectId,
      createProjectTransitionToWire(transition),
    );
  }

  async #commitTransition(
    projectId: ProjectId,
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
