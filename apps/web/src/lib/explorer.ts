/**
 * Explorer link for a transaction hash, chosen from the connection: Voyager
 * for Sepolia and mainnet, nothing for demo or a local devnet (there is no
 * explorer to link to, and a dead link is worse than none).
 */
import type { AppConfig } from "./store.js";

export function explorerTxUrl(cfg: Pick<AppConfig, "mode" | "rpcUrl" | "poolLocal">, txHash: string): string | null {
  if (cfg.mode === "demo" || cfg.poolLocal) return null;
  const rpc = (cfg.rpcUrl ?? "").toLowerCase();
  if (/localhost|127\.0\.0\.1/.test(rpc)) return null;
  if (rpc.includes("sepolia")) return `https://sepolia.voyager.online/tx/${txHash}`;
  if (rpc.includes("mainnet") || rpc.includes("starknet.io")) return `https://voyager.online/tx/${txHash}`;
  return null;
}
