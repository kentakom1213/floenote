import { spawnSync } from "node:child_process";
import process from "node:process";

function parseArgs(argv) {
  let name = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--name") {
      name = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!name) {
    throw new Error("Preview name is required. Pass --name <preview-name>.");
  }

  return { name, json };
}

function runPnpm(args, { env = process.env, label, forwardStdout = false } = {}) {
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    throw new Error(`${label ?? args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }

  if (forwardStdout && result.stdout) process.stderr.write(result.stdout);
  return result.stdout.trim();
}

function parsePreviewUrl(output, label) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }

  const url = parsed?.preview?.urls?.[0];
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`${label} did not return a Preview URL`);
  }

  return url;
}

const { name, json } = parseArgs(process.argv.slice(2));
const wranglerEnv = { ...process.env, CI: "true" };

const coordinatorOutput = runPnpm(
  [
    "--filter",
    "@floe-note/coordinator",
    "exec",
    "wrangler",
    "preview",
    "--name",
    name,
    "--json",
  ],
  { env: wranglerEnv, label: "Coordinator preview" },
);
const coordinatorUrl = parsePreviewUrl(coordinatorOutput, "Coordinator preview");

runPnpm(
  ["--filter", "@floe-note/web", "build"],
  {
    env: {
      ...process.env,
      VITE_COORDINATOR_URL: coordinatorUrl,
    },
    label: "Web build",
    forwardStdout: true,
  },
);

const webOutput = runPnpm(
  [
    "--filter",
    "@floe-note/coordinator",
    "exec",
    "wrangler",
    "preview",
    "--config",
    "../web/wrangler.jsonc",
    "--name",
    name,
    "--json",
  ],
  { env: wranglerEnv, label: "Web preview" },
);
const webUrl = parsePreviewUrl(webOutput, "Web preview");

const result = {
  name,
  webUrl,
  coordinatorUrl,
};

if (json) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  process.stdout.write(
    `Preview ${name}\nWeb: ${webUrl}\nCoordinator: ${coordinatorUrl}\n`,
  );
}
