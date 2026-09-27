import type { DeviceId, WorkspaceId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";

export type AuthorizedPresenceInvitationContext = {
  workspaceId: WorkspaceId;
  deviceId: DeviceId;
  securityHead: string;
};

export type AuthorizedInvitationAllocationResult =
  | {
      kind: "allocated";
      response: Response;
    }
  | {
      kind: "stale-security-head";
    }
  | {
      kind: "unauthorized-device";
    };

export async function allocateInvitationForAuthorizedPresence(
  state: SecurityState,
  context: AuthorizedPresenceInvitationContext,
  allocate: (workspaceId: WorkspaceId) => Promise<Response>,
): Promise<AuthorizedInvitationAllocationResult> {
  if (context.workspaceId !== state.workspaceId) {
    return { kind: "unauthorized-device" };
  }

  if (context.securityHead !== bytesToHex(state.headHash)) {
    return { kind: "stale-security-head" };
  }

  const authorized = state.devices.some(
    (device) => device.deviceId === context.deviceId,
  );
  if (!authorized) {
    return { kind: "unauthorized-device" };
  }

  return {
    kind: "allocated",
    response: await allocate(context.workspaceId),
  };
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
