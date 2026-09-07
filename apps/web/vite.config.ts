import react from "@vitejs/plugin-react";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { isSdkCompilerModule, patchSdkCompiler } from "./sdkPatch.js";

/**
 * Pool mode needs the Privacy SDK, which is not on npm. Like the CLI's
 * `config.pool.sdkPath`, the web app takes a BUILT starknet-privacy checkout
 * from the environment at build/dev time:
 *
 *   STARKNET_PRIVACY=<checkout> pnpm run web      # sdk/dist must exist
 *
 * The `privacy-sdk/*` ids below resolve into that checkout — by file path, so
 * the package's exports map (which hides `utils/hashes` behind the Node-only
 * `/testing` entry, M0 § S2) does not get in the way. Without the variable
 * every id resolves to a stub that throws a clear message the moment pool
 * mode is used, and demo/direct modes are unaffected.
 */
/** STARKNET_PRIVACY, else the checkout Scarb vendors for contracts/ if its SDK is built. */
function findCheckout(): string | null {
  if (process.env.STARKNET_PRIVACY) return process.env.STARKNET_PRIVACY;
  const base = resolve(homedir(), ".cache/scarb/registry/git/checkouts");
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith("starknet-privacy-")) continue;
    const candidate = resolve(base, dir, "bc75e4b");
    if (existsSync(resolve(candidate, "sdk/dist/index.js"))) return candidate;
  }
  return null;
}
const checkout = findCheckout();
const sdkRoot = checkout ? resolve(checkout, "sdk") : null;
const sdkDist = sdkRoot ? resolve(sdkRoot, "dist") : null;
const sdkAvailable = !!sdkDist && existsSync(resolve(sdkDist, "index.js"));
const stub = resolve(__dirname, "src/lib/privacy-sdk-missing.ts");

const SDK_MODULES: Record<string, string> = {
  "privacy-sdk": "index.js",
  "privacy-sdk/hashes": "utils/hashes.js",
  "privacy-sdk/abi": "internal/abi.js",
  "privacy-sdk/contract-discovery": "internal/contract-discovery.js",
  "privacy-sdk/mock-proving": "testing/screening-mock-proving.js",
};

const PROVER_PROXY = {
  // StarkWare's gateway does not answer CORS preflights, so the browser cannot
  // post proof-carrying transactions to it directly; the dev server can.
  // GATEWAY_URL overrides the target (mainnet: alpha-mainnet.starknet.io).
  "/gateway": {
    target: (process.env.GATEWAY_URL ?? "https://alpha-sepolia.starknet.io/gateway/add_transaction").replace(/\/gateway\/add_transaction$/, ""),
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/gateway/, "/gateway/add_transaction"),
    timeout: 120_000,
    proxyTimeout: 120_000,
  },
  // The operator's screening-enabled prover (deposits). SCREENING_PROVER_URL
  // sets the target; the browser reaches it as `/screening-prover`.
  ...(process.env.SCREENING_PROVER_URL
    ? {
        "/screening-prover": {
          target: process.env.SCREENING_PROVER_URL,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/screening-prover/, "") || "/",
          timeout: 900_000,
          proxyTimeout: 900_000,
        },
      }
    : {}),
  "/prover": {
    target: process.env.PROVER_URL ?? "http://127.0.0.1:3000",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/prover/, "") || "/",
    // Proofs take seconds to minutes; the default proxy timeout is shorter.
    timeout: 900_000,
    proxyTimeout: 900_000,
  },
};

/**
 * Apply the zero-note patch to the SDK's compiler module as it is loaded
 * (sdkPatch.ts) — dev server and production build alike. Without it, on an
 * unpatched checkout, every message-only send fails with "Created note
 * amount must be positive" unless the account holds a spendable note.
 */
const sdkZeroNotePatch: Plugin = {
  name: "strk20-sdk-zero-note-patch",
  enforce: "pre",
  transform(code, id) {
    if (!isSdkCompilerModule(id)) return null;
    const { code: patched, applied } = patchSdkCompiler(code);
    if (applied.length) console.log(`[strk20] patched Privacy SDK at load: ${applied.join(", ")}`);
    return applied.length ? { code: patched, map: null } : null;
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), sdkZeroNotePatch],
  resolve: {
    // Exact matches: Vite aliases match by PREFIX, so a bare `privacy-sdk`
    // entry would also rewrite `privacy-sdk/hashes` into `…/index.js/hashes`.
    alias: Object.entries(SDK_MODULES).map(([id, file]) => ({
      find: new RegExp(`^${id.replace(/[/.]/g, "\\$&")}$`),
      replacement: sdkAvailable ? resolve(sdkDist!, file) : stub,
    })),
  },
  // The checkout lives outside the workspace; the dev server must be allowed
  // to serve it (and its node_modules, which the SDK's dist imports from).
  //
  // `/prover` proxies to a self-hosted transaction prover on THIS machine, so a
  // browser that only reaches the dev server (VS Code forwards 5173, not 3000)
  // can still prove: proving URL `/prover`, same origin, no CORS, no second
  // forward. PROVER_URL overrides the target.
  server: {
    ...(sdkRoot ? { fs: { allow: [resolve(__dirname, "../.."), sdkRoot] } } : {}),
    proxy: PROVER_PROXY,
  },
  preview: { proxy: PROVER_PROXY },
  define: {
    "import.meta.env.VITE_POOL_SDK_AVAILABLE": JSON.stringify(sdkAvailable ? "1" : ""),
    // The dev-signer prefill (.env.local, written by `pnpm run web:devenv`) is
    // a DEV-SERVER convenience only. Production builds force these to empty so
    // a testnet key can never ride along inside dist/ — even when .env.local exists.
    ...(mode === "production"
      ? {
          "import.meta.env.VITE_DEV_SIGNER_ADDRESS": JSON.stringify(""),
          "import.meta.env.VITE_DEV_SIGNER_KEY": JSON.stringify(""),
        }
      : {}),
  },
}));
