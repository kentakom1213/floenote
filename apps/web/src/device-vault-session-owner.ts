import type { DeviceVaultSession } from "@floe-note/vault";

export type DeviceVaultSessionOwner = {
  current: DeviceVaultSession | null;
};

export function handoffDeviceVaultSession(
  owner: DeviceVaultSessionOwner,
  accept: (session: DeviceVaultSession) => void,
): void {
  const session = owner.current;
  if (!session) {
    throw new Error("Device Vault session is not available for handoff");
  }

  owner.current = null;
  try {
    accept(session);
  } catch (error) {
    owner.current = session;
    throw error;
  }
}

export async function closeOwnedDeviceVaultSession(
  owner: DeviceVaultSessionOwner,
): Promise<void> {
  const session = owner.current;
  owner.current = null;
  if (session) await session.close();
}
