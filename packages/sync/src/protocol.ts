import { parseDocumentId, type DocumentId } from "@floe-note/domain";

const PROTOCOL_VERSION = 1;
const HEADER_LENGTH = 2;
const DOCUMENT_ID_LENGTH = 36;

const enum MessageType {
  Hello = 1,
  ManifestUpdate = 2,
  DocumentUpdate = 3,
  FullStateEnd = 4,
  DocumentAck = 5,
}

export type SyncMessage =
  | { type: "hello" }
  | { type: "full-state-end" }
  | { type: "manifest-update"; update: Uint8Array }
  | {
      type: "document-update";
      documentId: DocumentId;
      update: Uint8Array;
    }
  | {
      type: "document-ack";
      documentId: DocumentId;
      frontiers: Uint8Array;
    };

function encodeDocumentId(documentId: DocumentId): Uint8Array {
  if (documentId.length !== DOCUMENT_ID_LENGTH) {
    throw new Error("DocumentId must be 36 ASCII characters");
  }

  const encoded = new Uint8Array(DOCUMENT_ID_LENGTH);
  for (let index = 0; index < documentId.length; index += 1) {
    const code = documentId.charCodeAt(index);
    if (code > 0x7f) {
      throw new Error("DocumentId must be ASCII");
    }
    encoded[index] = code;
  }

  return encoded;
}

function decodeDocumentId(data: Uint8Array): DocumentId {
  let value = "";
  for (const byte of data) {
    value += String.fromCharCode(byte);
  }
  return parseDocumentId(value);
}

export function encodeSyncMessage(message: SyncMessage): Uint8Array {
  switch (message.type) {
    case "hello":
      return Uint8Array.of(PROTOCOL_VERSION, MessageType.Hello);

    case "full-state-end":
      return Uint8Array.of(PROTOCOL_VERSION, MessageType.FullStateEnd);

    case "manifest-update": {
      const encoded = new Uint8Array(HEADER_LENGTH + message.update.length);
      encoded[0] = PROTOCOL_VERSION;
      encoded[1] = MessageType.ManifestUpdate;
      encoded.set(message.update, HEADER_LENGTH);
      return encoded;
    }

    case "document-update":
    case "document-ack": {
      const id = encodeDocumentId(message.documentId);
      const payload =
        message.type === "document-update" ? message.update : message.frontiers;
      const encoded = new Uint8Array(
        HEADER_LENGTH + DOCUMENT_ID_LENGTH + payload.length,
      );
      encoded[0] = PROTOCOL_VERSION;
      encoded[1] =
        message.type === "document-update"
          ? MessageType.DocumentUpdate
          : MessageType.DocumentAck;
      encoded.set(id, HEADER_LENGTH);
      encoded.set(payload, HEADER_LENGTH + DOCUMENT_ID_LENGTH);
      return encoded;
    }
  }
}

export function decodeSyncMessage(data: Uint8Array): SyncMessage {
  if (data.length < HEADER_LENGTH) {
    throw new Error("Sync message is too short");
  }

  if (data[0] !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported sync protocol version: ${data[0]}`);
  }

  switch (data[1]) {
    case MessageType.Hello:
      return { type: "hello" };

    case MessageType.FullStateEnd:
      return { type: "full-state-end" };

    case MessageType.ManifestUpdate:
      return {
        type: "manifest-update",
        update: data.slice(HEADER_LENGTH),
      };

    case MessageType.DocumentUpdate:
    case MessageType.DocumentAck: {
      if (data.length < HEADER_LENGTH + DOCUMENT_ID_LENGTH) {
        throw new Error("Document message is too short");
      }

      const documentId = decodeDocumentId(
        data.slice(HEADER_LENGTH, HEADER_LENGTH + DOCUMENT_ID_LENGTH),
      );
      const payload = data.slice(HEADER_LENGTH + DOCUMENT_ID_LENGTH);

      return data[1] === MessageType.DocumentUpdate
        ? { type: "document-update", documentId, update: payload }
        : { type: "document-ack", documentId, frontiers: payload };
    }

    default:
      throw new Error(`Unknown sync message type: ${data[1]}`);
  }
}
