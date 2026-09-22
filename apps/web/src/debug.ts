type DebugEventLike = {
  at: string;
  event: string;
  details: Record<string, unknown>;
  instanceId?: string;
};

export function createConsoleDebugLogger(scope: string) {
  return (event: DebugEventLike): void => {
    const instance = event.instanceId ? `:${event.instanceId}` : "";
    console.debug(
      `[floe:${scope}${instance}] ${event.event}`,
      event.details,
      event.at,
    );
  };
}
