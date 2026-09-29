export type PresenceSocketLike = {
  deserializeAttachment(): unknown;
};

export function findPresenceSocketsForDevice<T extends PresenceSocketLike>(
  sockets: readonly T[],
  deviceId: string,
): T[] {
  return sockets.filter((socket) => {
    const attachment = socket.deserializeAttachment();
    return (
      typeof attachment === "object" &&
      attachment !== null &&
      "kind" in attachment &&
      attachment.kind === "presence" &&
      "deviceId" in attachment &&
      attachment.deviceId === deviceId
    );
  });
}
