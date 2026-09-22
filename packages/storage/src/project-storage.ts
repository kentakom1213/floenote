import type { NoteProject } from "@floe-note/document";

export type OpenProjectResult = {
  project: NoteProject;
  isNew: boolean;
};

export interface ProjectStorage {
  openOrCreateProject(): Promise<OpenProjectResult>;
  watchProject(project: NoteProject): () => void;
}
