import { parsePortableWorkspaceImport, type ImportedPortableWorkspace } from "@floe-note/document";
import { useState } from "react";

import { Modal } from "./Modal.js";
import { readWorkspaceDirectory } from "./portable-workspace-import-integration.js";

type WorkspaceImportDialogProps = {
  onImport: (workspace: ImportedPortableWorkspace) => Promise<void>;
  onClose: () => void;
};

export function WorkspaceImportDialog({ onImport, onClose }: WorkspaceImportDialogProps) {
  const [imported, setImported] = useState<ImportedPortableWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(source: () => Promise<ImportedPortableWorkspace>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    setImported(null);
    try {
      setImported(await source());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read Workspace export");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!imported || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(imported);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import Workspace");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="workspace-import-title" disabled={busy} onClose={onClose}>
      <h2 id="workspace-import-title">Import Workspace</h2>
      {imported ? (
        <>
          <p className="dialog-description">
            A new Workspace will be created. Existing Workspaces will not be modified.
          </p>
          <dl>
            <dt>Name</dt><dd>{imported.name}</dd>
            <dt>Projects</dt><dd>{imported.projects.length}</dd>
            <dt>Notes</dt><dd>{imported.projects.reduce((count, project) => count + project.documents.length, 0)}</dd>
            <dt>Exported at</dt><dd>{new Date(imported.exportedAt).toLocaleString()}</dd>
          </dl>
        </>
      ) : (
        <>
          <p className="dialog-description">
            Select a .floe-workspace.zip export or its extracted directory.
          </p>
          <label className="dialog-field">
            <span>Workspace ZIP</span>
            <input
              autoFocus
              type="file"
              accept=".floe-workspace.zip,application/zip"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void read(async () => parsePortableWorkspaceImport(new Uint8Array(await file.arrayBuffer())));
              }}
            />
          </label>
          <label className="dialog-field">
            <span>Workspace directory</span>
            <input
              type="file"
              multiple
              disabled={busy}
              ref={(input) => { input?.setAttribute("webkitdirectory", ""); }}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (files.length) void read(() => readWorkspaceDirectory(files));
              }}
            />
          </label>
        </>
      )}
      {busy ? <p role="status">{imported ? "Creating Workspace…" : "Validating export…"}</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button className="dialog-secondary-button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        {imported ? (
          <button className="dialog-primary-button" type="button" disabled={busy} onClick={() => void confirm()}>Import</button>
        ) : null}
      </div>
    </Modal>
  );
}
