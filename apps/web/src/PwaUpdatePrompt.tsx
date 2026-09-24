import { useEffect, useRef, useState } from "react";

import { registerSW } from "virtual:pwa-register";

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export function PwaUpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);
  const updateServiceWorkerRef = useRef<UpdateServiceWorker | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let disposed = false;
    updateServiceWorkerRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (!disposed) setUpdateAvailable(true);
      },
      onRegisterError(error) {
        console.error("Floe Note service worker registration failed", error);
      },
    });

    return () => {
      disposed = true;
      updateServiceWorkerRef.current = null;
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <aside
      className="pwa-update-banner"
      role="status"
      aria-live="polite"
      aria-label="Application update"
    >
      <span>A new version of Floe Note is available.</span>
      <button
        type="button"
        disabled={reloading}
        onClick={() => {
          const updateServiceWorker = updateServiceWorkerRef.current;
          if (!updateServiceWorker) return;

          setReloading(true);
          void updateServiceWorker(true).catch((error: unknown) => {
            console.error("Failed to activate Floe Note update", error);
            setReloading(false);
          });
        }}
      >
        {reloading ? "Reloading…" : "Reload"}
      </button>
    </aside>
  );
}
