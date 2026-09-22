import type { ProjectId } from "@floe-note/domain";
import {
  createProjectTransitionToWire,
  parseSecurityStateWirePayload,
  type CreateProjectTransition,
  type SecurityState,
} from "@floe-note/security";

export class SecurityCoordinatorClient {
  readonly #baseUrl: URL;

  constructor(coordinatorBaseUrl: string) {
    this.#baseUrl = new URL(coordinatorBaseUrl);
  }

  async commitCreateProject(
    projectId: ProjectId,
    transition: CreateProjectTransition,
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
        body: JSON.stringify(createProjectTransitionToWire(transition)),
      },
    );

    await ensureOk(response);
    const payload = (await response.json()) as unknown;
    return parseSecurityStateWirePayload(payload, projectId);
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
