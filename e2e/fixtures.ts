import {
  expect,
  test as base,
  type CDPSession,
} from "@playwright/test";

type Fixtures = {
  prfAuthenticator: void;
};

export const test = base.extend<Fixtures>({
  prfAuthenticator: [
    async ({ page }, use) => {
      const client = await page.context().newCDPSession(page);
      await client.send("WebAuthn.enable");

      const { authenticatorId } = await client.send(
        "WebAuthn.addVirtualAuthenticator",
        {
          options: {
            protocol: "ctap2",
            ctap2Version: "ctap2_1",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            hasPrf: true,
            automaticPresenceSimulation: true,
            isUserVerified: true,
          },
        },
      );

      try {
        await use();
      } finally {
        await removeAuthenticator(client, authenticatorId);
      }
    },
    { auto: true },
  ],
});

async function removeAuthenticator(
  client: CDPSession,
  authenticatorId: string,
): Promise<void> {
  await client.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId,
  });
  await client.send("WebAuthn.disable");
}

export { expect };
