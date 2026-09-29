import { useRef } from "react";

import type { WorkspaceProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";

import { useDismissibleDetails } from "./useDismissibleDetails.js";

type SettingsScopeNavigationProps = {
  scope: "general" | "workspace" | "project";
  projects: readonly WorkspaceProject[];
  projectId: ProjectId | null;
  onGeneral: () => void;
  onWorkspace: () => void;
  onProject: (projectId: ProjectId) => void;
};

export function SettingsScopeNavigation({
  scope,
  projects,
  projectId,
  onGeneral,
  onWorkspace,
  onProject,
}: SettingsScopeNavigationProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menuRef);
  const active = projects.filter((project) => project.status === "active");
  const current = active.find((project) => project.id === projectId);

  return (
    <nav className="settings-scope-nav" aria-label="Settings sections">
      <button
        type="button"
        aria-current={scope === "general" ? "page" : undefined}
        onClick={onGeneral}
      >
        General
      </button>
      <button
        type="button"
        aria-current={scope === "workspace" ? "page" : undefined}
        onClick={onWorkspace}
      >
        Workspace
      </button>
      {active.length > 0 ? (
        <details className="settings-project-selector" ref={menuRef}>
          <summary aria-current={scope === "project" ? "page" : undefined}>
            <span>Projects: {current?.name ?? "Choose Project"}</span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="settings-project-menu">
            {active.map((project) => (
              <button
                key={project.id}
                type="button"
                aria-current={scope === "project" && project.id === projectId ? "page" : undefined}
                onClick={() => {
                  menuRef.current?.removeAttribute("open");
                  onProject(project.id);
                }}
              >
                {project.name}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}
