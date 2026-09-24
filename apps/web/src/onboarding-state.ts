import type { DeviceVaultUiState } from "./DeviceVaultPanel.js";

export type OnboardingAction =
  | "create"
  | "import-floe"
  | "import-markdown";

export type EntrySurface =
  | "checking"
  | "unlock"
  | "onboarding"
  | "workspace";

export function deriveEntrySurface(
  vaultState: DeviceVaultUiState,
  hasProject: boolean,
): EntrySurface {
  if (vaultState === "checking") return "checking";
  if (
    vaultState === "locked" ||
    vaultState === "unlocking" ||
    vaultState === "error"
  ) {
    return "unlock";
  }
  if (vaultState === "missing") return "onboarding";
  return hasProject ? "workspace" : "onboarding";
}

export function actionRequiresSecureDevice(
  action: OnboardingAction,
  vaultState: DeviceVaultUiState,
): boolean {
  return vaultState === "missing";
}
