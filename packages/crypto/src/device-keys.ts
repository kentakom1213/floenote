import { createDeviceId } from "@floe-note/domain";
import type { DevicePublicIdentity } from "@floe-note/security";
import sodium from "libsodium-wrappers";

export const DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES = 32;
export const DEVICE_SIGNING_PUBLIC_KEY_BYTES = 32;

export type DeviceKeyMaterial = {
  publicIdentity: DevicePublicIdentity;
  encryptionPrivateKey: Uint8Array;
  signingPrivateKey: Uint8Array;
};

export async function generateDeviceKeyMaterial(): Promise<DeviceKeyMaterial> {
  await sodium.ready;

  const encryptionKeyPair = sodium.crypto_box_keypair();
  const signingKeyPair = sodium.crypto_sign_keypair();

  try {
    assertLength(
      encryptionKeyPair.publicKey,
      DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
      "device encryption public key",
    );
    assertLength(
      signingKeyPair.publicKey,
      DEVICE_SIGNING_PUBLIC_KEY_BYTES,
      "device signing public key",
    );

    return {
      publicIdentity: {
        deviceId: createDeviceId(),
        encryptionPublicKey: encryptionKeyPair.publicKey.slice(),
        signingPublicKey: signingKeyPair.publicKey.slice(),
      },
      encryptionPrivateKey: encryptionKeyPair.privateKey,
      signingPrivateKey: signingKeyPair.privateKey,
    };
  } catch (error) {
    sodium.memzero(encryptionKeyPair.privateKey);
    sodium.memzero(signingKeyPair.privateKey);
    throw error;
  }
}

export async function destroyDeviceKeyMaterial(
  keyMaterial: DeviceKeyMaterial,
): Promise<void> {
  await sodium.ready;
  sodium.memzero(keyMaterial.encryptionPrivateKey);
  sodium.memzero(keyMaterial.signingPrivateKey);
}

function assertLength(
  value: Uint8Array,
  expectedLength: number,
  name: string,
): void {
  if (value.byteLength !== expectedLength) {
    throw new Error(
      `Unexpected ${name} length: expected ${expectedLength} bytes, got ${value.byteLength}`,
    );
  }
}
