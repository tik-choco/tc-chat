// Fetches mistlib source (MISTLIB_REPO/MISTLIB_REF from the repo root .env,
// shared with the web app's scripts/fetch-mistlib.mjs) into cli/.mistlib-src
// so cli/Cargo.toml's path dependency on mistlib-native resolves without
// requiring a separate sibling checkout of mistlib-dev.
//
// Copied from tc-mistllm/cli/scripts/fetch-mistlib.mjs. Unlike the web
// script, this does not build anything — `cargo build` picks up
// mistlib-native as a normal path dependency and compiles it itself.
import { config } from "dotenv";
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(cliDir);
config({ path: path.join(repoRoot, ".env") });

const repo = process.env.MISTLIB_REPO;
const ref = process.env.MISTLIB_REF || "develop";

if (!repo) {
  console.error("MISTLIB_REPO is not set in .env (repo root) — copy .env.example to .env and fill it in.");
  process.exit(1);
}

const cacheDir = path.join(cliDir, ".mistlib-src");

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

if (!existsSync(path.join(cacheDir, ".git"))) {
  rmSync(cacheDir, { recursive: true, force: true });
  run("git", ["clone", repo, cacheDir]);
} else {
  console.log(`cli/.mistlib-src already present — fetching latest ${ref} instead of re-cloning.`);
}

run("git", ["fetch", "origin", ref], cacheDir);
run("git", ["checkout", "FETCH_HEAD"], cacheDir);

console.log(`mistlib (${ref}) fetched into cli/.mistlib-src. Run \`cargo build\` in cli/ next.`);
