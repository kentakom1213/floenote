export const AUTHORIZED_PRESENCE_LEASE_MS = 90_000;

export type PresenceSocketLike = {
  deserializeAttachment(): unknown;
};

export function isPresenceLeaseActive(
  lastSeenAt: unknown,
  now = Date.now(),
): boolean {
  // Attachments created before lease-aware Presence was deployed do not have a
  // timestamp. Keep them routable until they reconnect rather than breaking
  // already-open older clients during rollout.
  if (lastSeenAt === undefined) return true;

  return (
    typeof lastSeenAt === "number" &&
    Number.isFinite(lastSeenAt) &&
    now - lastSeenAt < AUTHORIZED_PRESENCE_LEASE_MS
  );
}

export function findPresenceSocketsForDevice<T extends PresenceSocketLike>(
  sockets: readonly T[],
  deviceId: string,
  now = Date.now(),
): T[] {
  return sockets.filter((socket) => {
    const attachment = socket.deserializeAttachment();
    return (
      typeof attachment === "object" &&
      attachment !== null &&
      "kind" in attachment &&
      attachment.kind === "presence" &&
      "deviceId" in attachment &&
      attachment.deviceId === deviceId &&
      isPresenceLeaseActive(
        "lastSeenAt" in attachment ? attachment.lastSeenAt : undefined,
        now,
      )
    );
  });
}
