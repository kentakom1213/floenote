import { parseDocumentId, type DocumentId } from "@floe-note/domain";

const PROTOCOL_VERSION = 1;
const HEADER_LENGTH = 2;
const DOCUMENT_ID_LENGTH = 36;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const enum MessageType {
  Hello = 1,
  ManifestUpdate = 2,
  DocumentUpdate = 3,
}

export type SyncMessage =
  | { type: "hello" }
  | { type: "manifest-update"; update: Uint8Array }
  | {
      type: "document-update";
      documentId: DocumentId;
      update: Uint8Array;
    };

export function encodeSyncMessage(message: SyncMessage): Uint8Array {
  switch (message.type) {
    case "hello":
      return Uint8Array.of(PROTOCOL_VERSION, MessageType.Hello);

    case "manifest-update": {
      const encoded = new Uint8Array(HEADER_LENGTH + message.update.length);
      encoded[0] = PROTOCOL_VERSION;
      encoded[1] = MessageType.ManifestUpdate;
      encoded.set(message.update, HEADER_LENGTH);
      return encoded;
    }

    case "document-update": {
      const id = textEncoder.encode(message.documentId);
      if (id.length !== DOCUMENT_ID_LENGTH) {
        throw new Error("DocumentId must encode to 36 bytes");
      }

      const encoded = new Uint8Array(
        HEADER_LENGTH + DOCUMENT_ID_LENGTH + message.update.length,
      );
      encoded[0] = PROTOCOL_VERSION;
      encoded[1] = MessageType.DocumentUpdate;
      encoded.set(id, HEADER_LENGTH);
      encoded.set(message.update, HEADER_LENGTH + DOCUMENT_ID_LENGTH);
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

    case MessageType.ManifestUpdate:
      return {
        type: "manifest-update",
        update: data.slice(HEADER_LENGTH),
      };

    case MessageType.DocumentUpdate: {
      if (data.length < HEADER_LENGTH + DOCUMENT_ID_LENGTH) {
        throw new Error("Document update message is too short");
      }

      const documentId = parseDocumentId(
        textDecoder.decode(
          data.slice(HEADER_LENGTH, HEADER_LENGTH + DOCUMENT_ID_LENGTH),
        ),
      );

      return {
        type: "document-update",
        documentId,
        update: data.slice(HEADER_LENGTH + DOCUMENT_ID_LENGTH),
      };
    }

    default:
      throw new Error(`Unknown sync message type: ${data[1]}`);
  }
}
