// Runs wrangler, Cloudflare's command-line tool (installed by npm install).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// wrangler's package "exports" hide bin/, so find the script through package.json.
export function wranglerBin() {
  const pkgFile = require.resolve("wrangler/package.json");
  const { bin } = require(pkgFile);
  const rel = typeof bin === "string" ? bin : bin?.wrangler;
  if (!rel) throw new Error("Can't find wrangler. Run npm install in the gallery-tool folder.");
  return path.join(path.dirname(pkgFile), rel);
}

// The Cloudflare account to use. wrangler only asks which account when it has
// a terminal, so runs whose output we read would fail for logins with several.
let accountId = "";
export function useAccount(id) {
  accountId = id || "";
}

// With capture, returns wrangler's output instead of showing it.
export function wrangler(args, { capture = false } = {}) {
  const bin = wranglerBin();
  const env = accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } : process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env,
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

export async function mustWrangler(args, what) {
  const { code } = await wrangler(args);
  if (code !== 0) throw new Error(`${what} failed (see Cloudflare's message above).`);
}

const cells = (line) => line.split(/[│|]/).map((cell) => cell.trim());

// The accounts in `wrangler whoami` output: table rows holding a 32-character account ID.
export function parseAccounts(out) {
  const accounts = [];
  for (const line of out.split("\n")) {
    const id = line.match(/\b[0-9a-f]{32}\b/)?.[0];
    if (!id) continue;
    const name = cells(line).find((cell) => cell && cell !== id) ?? id;
    accounts.push({ id, name });
  }
  return accounts;
}

// A project's pages.dev address from `wrangler pages project list` output. The
// name must fill a whole cell, so "galleries" doesn't match "galleries-old".
export function findPagesUrl(out, project) {
  for (const line of out.split("\n")) {
    if (!cells(line).includes(project)) continue;
    const domain = line.match(/[a-z0-9-]+\.pages\.dev/)?.[0];
    if (domain) return `https://${domain}`;
  }
  return undefined;
}
