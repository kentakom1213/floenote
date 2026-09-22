import { useState } from "react";

import { Modal } from "./Modal.js";

type ProjectEmptyStateProps = {
  onCreateProject: (name: string) => Promise<void>;
};

export function ProjectEmptyState({
  onCreateProject,
}: ProjectEmptyStateProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProject(): Promise<void> {
    const name = projectName.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(null);
    try {
      await onCreateProject(name);
      setProjectName("");
      setCreateOpen(false);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not create Project",
      );
      setBusy(false);
    }
  }

  function joinProject(): void {
    if (busy) return;

    setError(null);
    try {
      const url = new URL(inviteUrl.trim(), window.location.origin);
      const isInvitation =
        url.origin === window.location.origin &&
        /^\/join\/v1\/[0-9a-f]{32}$/iu.test(url.pathname) &&
        new URLSearchParams(url.hash.slice(1)).has("s");

      if (!isInvitation) {
        throw new Error("Paste a valid Floe Note invitation link.");
      }

      setBusy(true);
      window.location.assign(url.toString());
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Invalid invitation link",
      );
    }
  }

  function closeDialogs(): void {
    if (busy) return;
    setCreateOpen(false);
    setJoinOpen(false);
    setError(null);
  }

  return (
    <main className="project-empty-screen">
      <section className="project-empty-card">
        <div className="empty-floe" aria-hidden="true">
          ◆
        </div>
        <p className="settings-eyebrow">Floe Note</p>
        <h1>No Projects on this device</h1>
        <p>
          Create a new Project here, or join one from another authorized device.
        </p>

        <div className="project-empty-actions">
          <button
            className="dialog-primary-button"
            type="button"
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
          >
            Create a project
          </button>
          <button
            className="dialog-secondary-button"
            type="button"
            onClick={() => {
              setError(null);
              setJoinOpen(true);
            }}
          >
            Join a project
          </button>
        </div>
      </section>

      {createOpen ? (
        <Modal
          labelledBy="empty-create-project-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-create-project-title">Create a project</h2>
          <p className="dialog-description">
            Create a separate local-first space for notes and devices.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createProject();
            }}
          >
            <label className="dialog-field">
              <span>Name</span>
              <input
                autoFocus
                value={projectName}
                maxLength={80}
                disabled={busy}
                placeholder="Research"
                onChange={(event) => setProjectName(event.target.value)}
              />
            </label>
            {error ? <p className="dialog-error">{error}</p> : null}
            <div className="dialog-actions">
              <button
                className="dialog-secondary-button"
                type="button"
                disabled={busy}
                onClick={closeDialogs}
              >
                Cancel
              </button>
              <button
                className="dialog-primary-button"
                type="submit"
                disabled={busy || projectName.trim().length === 0}
              >
                {busy ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {joinOpen ? (
        <Modal
          labelledBy="empty-join-project-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-join-project-title">Join a project</h2>
          <p className="dialog-description">
            Paste an invitation link created on an authorized device.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              joinProject();
            }}
          >
            <label className="dialog-field">
              <span>Invitation link</span>
              <input
                autoFocus
                value={inviteUrl}
                disabled={busy}
                placeholder="https://…/join/v1/…#s=…"
                onChange={(event) => setInviteUrl(event.target.value)}
              />
            </label>
            {error ? <p className="dialog-error">{error}</p> : null}
            <div className="dialog-actions">
              <button
                className="dialog-secondary-button"
                type="button"
                disabled={busy}
                onClick={closeDialogs}
              >
                Cancel
              </button>
              <button
                className="dialog-primary-button"
                type="submit"
                disabled={busy || inviteUrl.trim().length === 0}
              >
                Join project
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}
