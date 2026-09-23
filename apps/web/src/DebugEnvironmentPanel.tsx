import {
  useCoordinatorBuildInfo,
  webBuildInfo,
} from "./build-info.js";

type DebugEnvironmentPanelProps = {
  coordinatorBaseUrl: string;
};

export function DebugEnvironmentPanel({
  coordinatorBaseUrl,
}: DebugEnvironmentPanelProps) {
  const coordinatorBuildInfo = useCoordinatorBuildInfo(coordinatorBaseUrl);

  return (
    <section
      className="debug-environment-panel"
      aria-label="Development environment"
    >
      <p className="debug-environment-label">Development build</p>
      <p className="debug-environment-value">
        Web:{" "}
        <code>
          {webBuildInfo.version} / {webBuildInfo.build}
        </code>
      </p>
      <p className="debug-environment-value">
        Coordinator:{" "}
        {coordinatorBuildInfo.status === "checking" ? (
          <span>checking…</span>
        ) : coordinatorBuildInfo.status === "available" ? (
          <code>
            {coordinatorBuildInfo.info.version} /{" "}
            {coordinatorBuildInfo.info.build}
          </code>
        ) : (
          <span>unavailable</span>
        )}
      </p>
      <p className="debug-environment-value">
        Coordinator URL: <code>{coordinatorBaseUrl}</code>
      </p>
    </section>
  );
}
