import { useEffect, useState } from "react";

const STORAGE_KEY = "floe-note-turn-credential-endpoint";

export function readTurnCredentialEndpoint(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)?.trim();
    return stored ? stored : null;
  } catch {
    return null;
  }
}

export function clearTurnCredentialEndpoint(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Local preferences are best-effort.
  }
}

export function useTurnCredentialEndpoint(): [
  string | null,
  (endpoint: string | null) => void,
] {
  const [endpoint, setEndpoint] = useState<string | null>(
    readTurnCredentialEndpoint,
  );

  useEffect(() => {
    try {
      if (endpoint) {
        window.localStorage.setItem(STORAGE_KEY, endpoint);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Local preferences are best-effort.
    }
  }, [endpoint]);

  return [endpoint, setEndpoint];
}
