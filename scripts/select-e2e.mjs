import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const smoke = "e2e/smoke.spec.ts";
const sourceSpecs = {
  "apps/web/src/editor-indentation.ts": ["e2e/editor-indentation.spec.ts"],
  "apps/web/src/SidebarNavigationToolbar.tsx": [
    "e2e/navigation.spec.ts",
    "e2e/mobile-sidebar.spec.ts",
  ],
  "apps/web/src/ProjectSettingsView.tsx": [
    "e2e/project-ui.spec.ts",
    "e2e/settings-scopes.spec.ts",
    "e2e/navigation.spec.ts",
  ],
};

const full = { verifyRequired: true, mode: "all", specs: [] };

export function selectE2e(pages) {
  if (!Array.isArray(pages)) throw new Error("Invalid GitHub changed-files response");
  const files = pages.flat();
  if (files.length === 0) throw new Error("GitHub returned no changed files");

  const specs = new Set([smoke]);
  let verifyRequired = false;

  for (const file of files) {
    if (!file || typeof file.filename !== "string" || typeof file.status !== "string") {
      throw new Error("Invalid GitHub changed-file entry");
    }

    const { filename, status } = file;
    // Treat a rename conservatively even when its destination looks like documentation.
    if (status === "renamed") return full;
    if (!["added", "modified", "removed"].includes(status)) return full;

    if (filename.startsWith("docs/") || filename.endsWith(".md") || filename.startsWith(".github/ISSUE_TEMPLATE/")) {
      continue;
    }

    verifyRequired = true;
    if (status === "removed") return full;

    // New and edited specs can be selected; helpers and deleted specs cannot.
    if (/^e2e\/[a-zA-Z0-9_/-]+\.(spec|test)\.ts$/.test(filename)) {
      specs.add(filename);
      continue;
    }

    const selected = Object.hasOwn(sourceSpecs, filename) ? sourceSpecs[filename] : null;
    if (!selected) return full;
    for (const spec of selected) specs.add(spec);
  }

  return verifyRequired
    ? { verifyRequired, mode: "selected", specs: [...specs] }
    : { verifyRequired, mode: "none", specs: [] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const selection = selectE2e(JSON.parse(readFileSync(process.argv[2], "utf8")));
  process.stdout.write(`verify_required=${selection.verifyRequired}\n`);
  process.stdout.write(`e2e_required=${selection.mode !== "none"}\n`);
  process.stdout.write(`e2e_mode=${selection.mode}\n`);
  process.stdout.write(`e2e_specs=${JSON.stringify(selection.specs)}\n`);
  console.error(`E2E selection: ${selection.mode} ${selection.specs.join(" ")}`);
}
