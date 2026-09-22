import type { ProjectId } from "@floe-note/domain";

import type { Transport } from "./transport.js";

const CHANNEL_PREFIX = "floe-note:project:";

export class BroadcastChannelTransport implements Transport {
  readonly #channel: BroadcastChannel;

  constructor(projectId: ProjectId) {
    this.#channel = new BroadcastChannel(`${CHANNEL_PREFIX}${projectId}`);
  }

  send(data: Uint8Array): void {
    this.#channel.postMessage(data);
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    const listener = (event: MessageEvent<unknown>) => {
      if (event.data instanceof Uint8Array) {
        handler(event.data);
      }
    };

    this.#channel.addEventListener("message", listener);
    return () => this.#channel.removeEventListener("message", listener);
  }

  close(): void {
    this.#channel.close();
  }
}
