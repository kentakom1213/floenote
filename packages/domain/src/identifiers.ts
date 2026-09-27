import { v7 as uuidv7 } from "uuid";

declare const identifierBrand: unique symbol;

type Identifier<Kind extends string> = string & {
  readonly [identifierBrand]: Kind;
};

export type WorkspaceId = Identifier<"WorkspaceId">;
export type DocumentId = Identifier<"DocumentId">;
export type DeviceId = Identifier<"DeviceId">;
export type AttachmentId = Identifier<"AttachmentId">;
export type CheckpointId = Identifier<"CheckpointId">;

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuidV7<Kind extends string>(
  value: string,
  kind: Kind,
): Identifier<Kind> {
  if (!UUID_V7_PATTERN.test(value)) {
    throw new TypeError(`${kind} must be a UUIDv7`);
  }

  return value as Identifier<Kind>;
}

function createUuidV7<Kind extends string>(): Identifier<Kind> {
  return uuidv7() as Identifier<Kind>;
}

export function createWorkspaceId(): WorkspaceId {
  return createUuidV7();
}

export function createDocumentId(): DocumentId {
  return createUuidV7();
}

export function createDeviceId(): DeviceId {
  return createUuidV7();
}

export function createAttachmentId(): AttachmentId {
  return createUuidV7();
}

export function createCheckpointId(): CheckpointId {
  return createUuidV7();
}

export function parseWorkspaceId(value: string): WorkspaceId {
  return parseUuidV7(value, "WorkspaceId");
}

export function parseDocumentId(value: string): DocumentId {
  return parseUuidV7(value, "DocumentId");
}

export function parseDeviceId(value: string): DeviceId {
  return parseUuidV7(value, "DeviceId");
}

export function parseAttachmentId(value: string): AttachmentId {
  return parseUuidV7(value, "AttachmentId");
}

export function parseCheckpointId(value: string): CheckpointId {
  return parseUuidV7(value, "CheckpointId");
}
