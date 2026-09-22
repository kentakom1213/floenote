import { describe, expect, it } from "vitest";

import {
  decodeSyncMessage,
  encodeSyncMessage,
} from "../src/index.js";

describe("full-state-end sync message", () => {
  it("round-trips through the binary protocol", () => {
    const encoded = encodeSyncMessage({ type: "full-state-end" });

    expect(decodeSyncMessage(encoded)).toEqual({
      type: "full-state-end",
    });
  });
});
