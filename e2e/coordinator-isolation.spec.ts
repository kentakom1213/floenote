import { expect, test } from "@playwright/test";

test("uses one signaling scope per Workspace regardless of UUID casing", async ({ page }) => {
  await page.goto("/");

  const messages = await page.evaluate(async () => {
    const sessionId = "a".repeat(32);
    const workspaceA = "00000000-0000-7000-8000-0000000000aa";
    const workspaceB = "00000000-0000-7000-8000-0000000000bb";
    const received = {
      firstA: [] as string[],
      firstB: [] as string[],
      secondA: [] as string[],
    };

    function connect(workspaceId: string, inbox: string[]): Promise<WebSocket> {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:8787/workspaces/${workspaceId}/sessions/${sessionId}`,
        );
        socket.addEventListener("message", (event) => {
          inbox.push(String(event.data));
        });
        socket.addEventListener("open", () => resolve(socket), { once: true });
        socket.addEventListener("error", () => {
          reject(new Error("Signaling connection failed"));
        }, { once: true });
      });
    }

    const sockets: WebSocket[] = [];
    try {
      const [firstA, firstB] = await Promise.all([
        connect(workspaceA, received.firstA),
        connect(workspaceB, received.firstB),
      ]);
      sockets.push(firstA, firstB);
      const secondA = await connect(workspaceA.toUpperCase(), received.secondA);
      sockets.push(secondA);
      const deadline = Date.now() + 2_000;
      while (
        (received.firstA.length === 0 || received.secondA.length === 0) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      return received;
    } finally {
      for (const socket of sockets) socket.close();
    }
  });

  expect(messages.firstB).toEqual([]);
  expect(messages.firstA).toEqual([JSON.stringify({ type: "peer-ready" })]);
  expect(messages.secondA).toEqual([JSON.stringify({ type: "peer-ready" })]);
});
