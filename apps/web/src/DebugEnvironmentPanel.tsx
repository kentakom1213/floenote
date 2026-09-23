type DebugEnvironmentPanelProps = {
  coordinatorBaseUrl: string;
};

export function DebugEnvironmentPanel({
  coordinatorBaseUrl,
}: DebugEnvironmentPanelProps) {
  return (
    <section className="debug-environment-panel" aria-label="Development environment">
      <p className="debug-environment-label">Development build</p>
      <p className="debug-environment-value">
        Coordinator: <code>{coordinatorBaseUrl}</code>
      </p>
    </section>
  );
}
