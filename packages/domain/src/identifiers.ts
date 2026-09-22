declare const identifierBrand: unique symbol;

type Identifier<Kind extends string> = string & {
  readonly [identifierBrand]: Kind;
};

export type ProjectId = Identifier<"ProjectId">;
export type DocumentId = Identifier<"DocumentId">;
export type DeviceId = Identifier<"DeviceId">;
export type AttachmentId = Identifier<"AttachmentId">;

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

export function parseProjectId(value: string): ProjectId {
  return parseUuidV7(value, "ProjectId");
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
