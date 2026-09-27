import type { Transport } from "@floe-note/transport";

export type WorkspaceSyncCipher = {
  encrypt(plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(envelope: Uint8Array): Promise<Uint8Array>;
};

export type EncryptedSyncTransportDirection = "send" | "receive";

export type EncryptedSyncTransportOptions = {
  onError?: (
    error: Error,
    direction: EncryptedSyncTransportDirection,
  ) => void;
};

export class EncryptedSyncTransport implements Transport {
  readonly #transport: Transport;
  readonly #cipher: WorkspaceSyncCipher;
  readonly #onError:
    | ((
        error: Error,
        direction: EncryptedSyncTransportDirection,
      ) => void)
    | null;
  readonly #messageHandlers = new Set<(data: Uint8Array) => void>();
  readonly #stopTransportSubscription: () => void;
  #sendQueue: Promise<void> = Promise.resolve();
  #receiveQueue: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(
    transport: Transport,
    cipher: WorkspaceSyncCipher,
    options: EncryptedSyncTransportOptions = {},
  ) {
    this.#transport = transport;
    this.#cipher = cipher;
    this.#onError = options.onError ?? null;

    this.#stopTransportSubscription = transport.onMessage((envelope) => {
      const copy = envelope.slice();
      this.#receiveQueue = this.#receiveQueue
        .then(async () => {
          if (this.#closed) return;

          const plaintext = await this.#cipher.decrypt(copy);
          if (this.#closed) return;

          for (const handler of this.#messageHandlers) {
            handler(plaintext);
          }
        })
        .catch((error: unknown) => {
          this.#reportError(error, "receive");
        });
    });
  }

  send(data: Uint8Array): void {
    if (this.#closed) return;

    const copy = data.slice();
    this.#sendQueue = this.#sendQueue
      .then(async () => {
        if (this.#closed) return;

        const envelope = await this.#cipher.encrypt(copy);
        if (this.#closed) return;

        this.#transport.send(envelope);
      })
      .catch((error: unknown) => {
        this.#reportError(error, "send");
      });
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    if (this.#closed) {
      return () => undefined;
    }

    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopTransportSubscription();
    this.#messageHandlers.clear();
    this.#transport.close();
  }

  #reportError(
    error: unknown,
    direction: EncryptedSyncTransportDirection,
  ): void {
    if (this.#closed) return;

    this.#onError?.(
      error instanceof Error
        ? error
        : new Error(String(error)),
      direction,
    );
  }
}
