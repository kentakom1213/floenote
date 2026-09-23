import { useEffect, useState } from "react";

export type BuildInfo = {
  version: string;
  build: string;
};

export type CoordinatorBuildInfoState =
  | { status: "checking" }
  | { status: "available"; info: BuildInfo }
  | { status: "unavailable" };

export const webBuildInfo: BuildInfo = {
  version: import.meta.env.VITE_WEB_VERSION ?? "unknown",
  build: import.meta.env.VITE_WEB_BUILD ?? "unknown",
};

export function parseCoordinatorHealth(value: unknown): BuildInfo | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ok" in value) ||
    value.ok !== true ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    value.version.length === 0 ||
    !("build" in value) ||
    typeof value.build !== "string" ||
    value.build.length === 0
  ) {
    return null;
  }

  return {
    version: value.version,
    build: value.build,
  };
}

export function useCoordinatorBuildInfo(
  coordinatorBaseUrl: string,
): CoordinatorBuildInfoState {
  const [state, setState] = useState<CoordinatorBuildInfoState>({
    status: "checking",
  });

  useEffect(() => {
    const controller = new AbortController();
    const healthUrl = new URL("/health", coordinatorBaseUrl).toString();

    setState({ status: "checking" });

    void fetch(healthUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return parseCoordinatorHealth(await response.json());
      })
      .then((info) => {
        if (!controller.signal.aborted) {
          setState(
            info
              ? { status: "available", info }
              : { status: "unavailable" },
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "unavailable" });
        }
      });

    return () => controller.abort();
  }, [coordinatorBaseUrl]);

  return state;
}
