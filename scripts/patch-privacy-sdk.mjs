#!/usr/bin/env node
/**
 * (Re)apply our two one-line patches to the vendored Privacy SDK and rebuild it.
 * Idempotent. The SDK lives in Scarb's git cache, which can be re-fetched and
 * lose local edits — run this after any `scarb` fetch, before pool-mode work.
 *
 *   node scripts/patch-privacy-sdk.mjs      # STARKNET_PRIVACY, else the vendored checkout
 *
 * Patch 1 — compiler.ts: allow ZERO-amount created notes. The pool explicitly
 *   sanctions them (packages/privacy/src/actions.cairo:102-103); they are the
 *   free replay-protection carrier for message-only transactions, so a message
 *   needs no funds and no screened deposit. Proven against the real pool
 *   contract in apps/cli/test/e2e-pool.test.ts.
 * Patch 2 — compiler.ts: never auto-SELECT a zero-amount note as an input. The
 *   pool rejects UseNote on it; selecting one (autoSelectNotes: "all") failed the
 *   whole transaction — caught by the same e2e.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function findCheckout() {
  if (process.env.STARKNET_PRIVACY) return process.env.STARKNET_PRIVACY;
  const base = join(homedir(), ".cache/scarb/registry/git/checkouts");
  for (const dir of existsSync(base) ? readdirSync(base) : []) {
    if (dir.startsWith("starknet-privacy-") && existsSync(join(base, dir, "bc75e4b/sdk/package.json"))) {
      return join(base, dir, "bc75e4b");
    }
  }
  throw new Error("no starknet-privacy checkout; set STARKNET_PRIVACY");
}

const P = findCheckout();
const file = join(P, "sdk/src/internal/compiler.ts");
let s = readFileSync(file, "utf8");
let changed = 0;

const patches = [
  {
    name: "zero-amount created notes",
    marker: "PATCH (strk20-messaging): the pool explicitly sanctions zero-amount",
    old: `        assert(
          isOpen(c.amount) || c.amount > 0n,
          () => \`Created note amount must be positive (token: \${toHex(c.token)})\`
        );`,
    new: `        // PATCH (strk20-messaging): the pool explicitly sanctions zero-amount
        // encrypted notes (packages/privacy/src/actions.cairo:102-103); they are
        // the free replay-protection carrier for message-only transactions.
        assert(
          isOpen(c.amount) || c.amount >= 0n,
          () => \`Created note amount must be non-negative (token: \${toHex(c.token)})\`
        );`,
  },
  {
    name: "never select zero notes as inputs",
    marker: "carrier, not a balance",
    old: `          if (usedNoteIds.has(note.id)) continue; // Skip used notes
`,
    new: `          if (usedNoteIds.has(note.id)) continue; // Skip used notes
          // PATCH (strk20-messaging): a zero-amount note can never be spent
          // (the pool rejects UseNote on it) — it is a replay-protection
          // carrier, not a balance. Selecting it makes the whole tx fail.
          if (note.amount === 0n) continue;
`,
  },
];

for (const p of patches) {
  if (s.includes(p.marker)) {
    console.log(`✓ already applied: ${p.name}`);
  } else if (s.includes(p.old)) {
    s = s.replace(p.old, p.new);
    changed++;
    console.log(`+ applied: ${p.name}`);
  } else {
    console.error(`✗ anchor not found for: ${p.name} — the SDK source changed; re-derive the patch`);
    process.exit(1);
  }
}
if (changed) writeFileSync(file, s);

const built = join(P, "sdk/dist/internal/compiler.js");
const stale = !existsSync(built) || changed > 0 || !readFileSync(built, "utf8").includes("carrier, not a balance");
if (stale) {
  console.log("building the SDK …");
  execSync("npx tsc -p tsconfig.build.json", { cwd: join(P, "sdk"), stdio: "inherit" });
}
console.log(`done — ${P}/sdk/dist is patched${stale ? " and rebuilt" : ""}. Restart the web dev server to pick it up.`);
