#!/usr/bin/env node
/**
 * Local pool-mode test environment for the web app (16-arch1-plan.md § W8).
 *
 * Starts the Privacy SDK's own devnet harness — the REAL pool contract, mock
 * proving — deploys our helper with `pool` = that pool, seeds alice and bob
 * (registered, shielded, notes matured), and prints one JSON block to paste
 * into Settings → Pool → "paste local devnet env…". Stays up until Ctrl-C.
 *
 *   pnpm run web:devnet     # STARKNET_PRIVACY=<checkout>, else the one Scarb vendors
 *
 * Needs: the checkout built (sdk/dist + `scarb build` at its root), our
 * contracts built (`cd contracts && scarb build`), starknet-devnet 0.8.0-rc.3
 * on PATH. Then start the app with the same STARKNET_PRIVACY so it bundles the SDK.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * STARKNET_PRIVACY, or the checkout Scarb already vendors for our contracts
 * (contracts/Scarb.toml pins the same commit) — as long as its SDK is built.
 */
function findCheckout() {
  if (process.env.STARKNET_PRIVACY) return process.env.STARKNET_PRIVACY;
  const base = join(homedir(), ".cache/scarb/registry/git/checkouts");
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith("starknet-privacy-")) continue;
    const candidate = join(base, dir, "bc75e4b");
    if (existsSync(join(candidate, "sdk/dist/index.js"))) return candidate;
  }
  return null;
}

const P = findCheckout();
if (!P) {
  console.error(
    "no built starknet-privacy checkout found.\n" +
      "  Either set STARKNET_PRIVACY=<checkout>, or build the one Scarb vendors:\n" +
      "  P=~/.cache/scarb/registry/git/checkouts/starknet-privacy-*/bc75e4b\n" +
      "  (cd $P/sdk && npm ci && npm run build) && (cd $P && scarb build -p privacy)"
  );
  process.exit(2);
}
if (!process.env.STARKNET_PRIVACY) console.log(`using the Scarb-vendored checkout: ${P}`);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = join(root, "contracts/target/dev");
const DEPOSIT = 10_000_000n;

const harness = await import(pathToFileURL(`${P}/sdk/dist/testing/index.js`).href);
const devnet = new harness.Devnet();
const { env, transfers } = await harness.createDevnetTestEnv(devnet);
const rpcUrl = env.node.channel.nodeUrl;

// Our helper, pinned to the real pool contract.
const contract = JSON.parse(readFileSync(join(artifacts, "message_anonymizer_MessageAnonymizer.contract_class.json"), "utf8"));
const casm = JSON.parse(readFileSync(join(artifacts, "message_anonymizer_MessageAnonymizer.compiled_contract_class.json"), "utf8"));
const declared = await env.alice.declareAndDeploy(
  { contract, casm, constructorCalldata: [env.privacy.address] },
  { tip: 0n }
);
const helperAddress = declared.deploy.contract_address;

// Seed both parties: approve + shield registers them (autoRegister), opens
// their self-channels and gives each spendable notes. executeOutside mines
// the ten blocks that mature them.
const seeded = [];
for (const [name, account, t, viewingKey] of [
  ["alice", env.alice, transfers.alice, "0xA11CE"], // the harness's own viewing keys
  ["bob", env.bob, transfers.bob, "0xB0B"], //          (sdk/src/testing/devnet.ts)
]) {
  await account.execute({
    contractAddress: env.strk,
    entrypoint: "approve",
    calldata: [env.privacy.address, DEPOSIT, 0n],
  });
  const dep = await t
    .build({ autoRegister: true, autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } })
    .with(env.strk)
    .deposit({ amount: DEPOSIT })
    .surplusTo(account.address)
    .execute();
  await devnet.executeOutside(dep.callAndProof);
  const pk = String(account.signer.pk);
  seeded.push({
    name,
    address: account.address,
    privateKey: pk.startsWith("0x") ? pk : `0x${pk}`,
    viewingKey,
  });
}

const block = {
  "strk20msg-devnet": 1,
  rpcUrl,
  helperAddress,
  poolAddress: env.privacy.address,
  carrierToken: env.strk,
  accounts: seeded,
};

// The devnet's RPC log scrolls this away within seconds — so it also goes to
// a git-ignored file you can `cat` any time the devnet is up.
const envFile = join(root, ".devnet-env.local.json");
writeFileSync(envFile, JSON.stringify(block, null, 2) + "\n");
console.log("\n== paste this into Settings → Pool → \"paste local devnet env…\" ==\n");
console.log(JSON.stringify(block, null, 2));
console.log(`\n(also saved to ${envFile} — \`cat\` it if this scrolls away)`);
console.log(`
== ready ==
pool     ${env.privacy.address}
helper   ${helperAddress}  (pool() = the pool)
rpc      ${rpcUrl}
alice/bob each hold ${DEPOSIT} of ${env.strk} inside the pool.
Start the app with the SAME STARKNET_PRIVACY so it bundles the SDK:
  STARKNET_PRIVACY=${P} pnpm run web
Ctrl-C stops the devnet.`);

// The harness's devnet child does not keep Node's event loop alive on its
// own — without a live handle the script exits right after printing (and
// leaves the devnet orphaned). A ref'd timer is the handle.
const keepAlive = setInterval(() => {}, 1 << 30);
const stop = async () => {
  clearInterval(keepAlive);
  await devnet.cleanup?.();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
