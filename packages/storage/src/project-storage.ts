import type { NoteProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";

export type OpenProjectResult = {
  project: NoteProject;
  isNew: boolean;
};

export interface ProjectStorage {
  openOrCreateProject(): Promise<OpenProjectResult>;
  initializeJoinedProject(projectId: ProjectId): Promise<NoteProject>;
  watchProject(project: NoteProject): () => void;
}
