import type { ProjectId } from "@floe-note/domain";
import {
  addDeviceTransitionToWire,
  createProjectTransitionToWire,
  parseSecurityStateWirePayload,
  type AddDeviceTransition,
  type CreateProjectTransition,
  type SecurityState,
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
