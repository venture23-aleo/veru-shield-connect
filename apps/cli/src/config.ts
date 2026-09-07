import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ChannelConfig {
  /** Human name used by `send --to`. */
  label: string;
  /** Counterparty Starknet address (informational; the key is what addresses slots). */
  peer: string;
  /**
   * Directional channel key, hex. In pool mode this comes from the Privacy SDK's
   * channel scan; in direct (dev) mode it is provisioned out of band.
   */
  channelKey: string;
  /** "in" = they pay us, "out" = we pay them. Set by `channel discover`. */
  direction?: "in" | "out";
  /** True when `channel discover` found it, rather than a hand-entered key. */
  discovered?: boolean;
  /** Pool mode: our channel to them is open on-chain (first send done) — until then a send adds `setup(peer)`. */
  setupDone?: boolean;
}

export interface PoolConfig {
  /** Path to a built starknet-privacy checkout (sdk/dist must exist). */
  sdkPath: string;
  poolAddress: string;
  provingUrl?: string;
  /** Indexer URL for channel discovery. */
  discoveryUrl?: string;
  /**
   * OHTTP for discovery and proving. Default on: it hides the client IP from
   * both services, and the prover already sees the witness (02-threat-model).
   */
  ohttp?: boolean | { relayUrl?: string };
  /** Token used for the carrier note on message-only sends. */
  carrierToken?: string;
  /** Prefer env STRK20_MSG_VIEWING_KEY over storing this in the file. */
  viewingKey?: string;
  /**
   * Where proof-carrying transactions are SUBMITTED. Live networks need
   * StarkWare's gateway (gateway.ts says why the RPC cannot be used);
   * defaults per chain id, `false` forces the RPC (devnet).
   */
  gatewayUrl?: string | false;
}

export interface CliConfig {
  rpcUrl: string;
  helperAddress: string;
  /**
   * "pool": submit through the STRK20 pool (needs proving). The payer is the
   * visible submitter by design (16-arch1-plan.md); the recipient and the
   * amount stay private.
   * "direct": call the helper straight from the account — DEV ONLY: the helper
   * must have been deployed with this account as `pool`, and nothing is private.
   */
  mode: "direct" | "pool";
  account: {
    address: string;
    /** Prefer env STRK20_MSG_PRIVATE_KEY over storing this in the file. */
    privateKey?: string;
  };
  channels: ChannelConfig[];
  pool?: PoolConfig;
}

export function configDir(): string {
  return process.env.STRK20_MSG_HOME ?? join(homedir(), ".strk20-msg");
}

export function loadConfig(): CliConfig {
  const p = join(configDir(), "config.json");
  if (!existsSync(p)) {
    throw new Error(`no config at ${p} — run: msg init --rpc <url> --helper <addr> --account <addr>`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as CliConfig;
}

export function saveConfig(cfg: CliConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "config.json"), JSON.stringify(cfg, null, 2) + "\n");
}

export function privateKey(cfg: CliConfig): string {
  const pk = process.env.STRK20_MSG_PRIVATE_KEY ?? cfg.account.privateKey;
  if (!pk) throw new Error("no private key: set STRK20_MSG_PRIVATE_KEY or account.privateKey");
  return pk;
}

/** Pool config or a message that says which mode the caller is actually in. */
export function poolConfig(cfg: CliConfig): PoolConfig {
  if (!cfg.pool) throw new Error(`mode is '${cfg.mode}' but config.pool is missing`);
  return cfg.pool;
}

/**
 * The viewing key, as a `bigint`, always.
 *
 * The SDK types it as a plain bigint in [1, MAX_VIEWING_KEY] with no wrapper
 * (M0 § S4). Handing it a hex *string* does not throw — discovery just returns
 * nothing, which reads to the user as "my messages and money are gone". So the
 * conversion happens here, once, and nowhere else.
 */
export function viewingKey(cfg: CliConfig): bigint {
  const raw = process.env.STRK20_MSG_VIEWING_KEY ?? cfg.pool?.viewingKey;
  if (!raw) {
    throw new Error(
      "no viewing key: set STRK20_MSG_VIEWING_KEY (or pool.viewingKey) — it is what decrypts your channels"
    );
  }
  const trimmed = raw.trim();
  if (!/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error(`viewing key must be hex (got ${JSON.stringify(raw.slice(0, 12))}…)`);
  }
  const key = BigInt(trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`);
  if (key <= 0n) throw new Error("viewing key must be positive");
  return key;
}

/** Client state is { channelKey -> nextIndex } and nothing else (06-sdk.md). */
export type Cursors = Record<string, number>;

export function loadCursors(): Cursors {
  const p = join(configDir(), "state.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Cursors) : {};
}

export function saveCursors(c: Cursors): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "state.json"), JSON.stringify(c, null, 2) + "\n");
}
