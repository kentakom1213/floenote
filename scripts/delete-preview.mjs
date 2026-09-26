import { spawnSync } from "node:child_process";
import process from "node:process";

function parseName(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const index = args.indexOf("--name");
  const name = index >= 0 ? args[index + 1] : null;

  if (!name) {
    throw new Error("Preview name is required. Pass --name <preview-name>.");
  }

  return name;
}

function deletePreview(args, label) {
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.stderr.write(`${label} cleanup failed.\n`);
    return false;
  }

  return true;
}

const name = parseName(process.argv.slice(2));

const webDeleted = deletePreview(
  [
    "--filter",
    "@floe-note/coordinator",
    "exec",
    "wrangler",
    "preview",
    "delete",
    "--config",
    "../web/wrangler.jsonc",
    "--name",
    name,
    "--skip-confirmation",
  ],
  "Web preview",
);

const coordinatorDeleted = deletePreview(
  [
    "--filter",
    "@floe-note/coordinator",
    "exec",
    "wrangler",
    "preview",
    "delete",
    "--name",
    name,
    "--skip-confirmation",
  ],
  "Coordinator preview",
);

if (!webDeleted || !coordinatorDeleted) {
  process.exitCode = 1;
}
