import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMPONENT_PATHS = {
  web: "apps/web/package.json",
  coordinator: "apps/coordinator/package.json",
};

const BUMP_KINDS = new Set(["patch", "minor", "major"]);

export function bumpSemver(version, bump) {
  if (!BUMP_KINDS.has(bump)) {
    throw new Error(`Invalid bump "${bump}". Use patch, minor, or major.`);
  }

  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) {
    throw new Error(`Current version "${version}" is not a plain SemVer version.`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (bump === "patch") {
    patch += 1;
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    major += 1;
    minor = 0;
    patch = 0;
  }

  return `${major}.${minor}.${patch}`;
}

export function componentPackagePath(component) {
  const packagePath = COMPONENT_PATHS[component];
  if (!packagePath) {
    throw new Error(
      `Invalid component "${component}". Use web or coordinator.`,
    );
  }
  return packagePath;
}

export function assertCleanWorkingTree(statusOutput) {
  if (statusOutput.trim() !== "") {
    throw new Error(
      "Working tree is not clean. Commit, stash, or discard existing changes before bumping a release version.",
    );
  }
}

function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function run() {
  const [component, bump, ...extra] = process.argv.slice(2);
  if (!component || !bump || extra.length > 0) {
    throw new Error(
      "Usage: pnpm version:web <patch|minor|major> or pnpm version:coordinator <patch|minor|major>",
    );
  }

  const root = repositoryRoot();
  const packageRelativePath = componentPackagePath(component);
  assertCleanWorkingTree(
    execFileSync(
      "git",
      ["-C", root, "status", "--porcelain=v1", "--untracked-files=normal"],
      { encoding: "utf8" },
    ),
  );

  const packagePath = join(root, packageRelativePath);
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof packageJson.version !== "string") {
    throw new Error(`${packageRelativePath} does not contain a string version.`);
  }

  const previousVersion = packageJson.version;
  const nextVersion = bumpSemver(previousVersion, bump);
  packageJson.version = nextVersion;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(
    `${component}: ${previousVersion} -> ${nextVersion} (${packageRelativePath})`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
