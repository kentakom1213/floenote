import type { NoteProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";

export type OpenProjectResult = {
  project: NoteProject;
  isNew: boolean;
};

export interface ProjectStorage {
  openOrCreateProject(): Promise<OpenProjectResult>;
  initializeJoinedProject(projectId: ProjectId): Promise<NoteProject>;
  loadSecurityState(projectId: ProjectId): Promise<SecurityState | null>;
  saveCommittedSecurityState(state: SecurityState): Promise<void>;
  watchProject(project: NoteProject): () => void;
}
