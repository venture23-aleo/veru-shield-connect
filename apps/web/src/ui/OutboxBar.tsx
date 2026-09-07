import { CheckCircle, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { batchPreview, fmtUsd } from "../lib/costs.js";
import { explorerTxUrl } from "../lib/explorer.js";
import { store } from "../lib/store.js";
import { typicalWalletSeconds, walletWaitText } from "../lib/walletBackend.js";
import type { Bucket } from "@strk20-messaging/sdk";
import { StatusFooter } from "./WorkspaceShell.js";

/**
 * The batch is a control, not a spinner (12-client-and-ui.md): count, time
 * and cost are shown BEFORE the button is pressed; proving runs as an honest
 * progress line afterwards, cancellable until submission.
 */
export function OutboxBar() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const tiers = store.queuedTiers() as Bucket[];
  const flush = store.flush;
  const cfg = store.config!;
  const proving = flush.phase === "encrypting" || flush.phase === "proving" || flush.phase === "submitted";
  const elapsed = flush.startedAt ? (Date.now() - flush.startedAt) / 1000 : 0;
  const total = flush.secondsTotal ?? cfg.provingSeconds;
  const pct = flush.phase === "submitted" ? 100 : flush.phase === "encrypting" ? 5 : Math.min(97, 5 + (elapsed / total) * 92);

  return (
    <div className="border-t border-border bg-surface-lowest">
      {proving && (
        <div className="flex flex-col gap-1.5 border-b border-border px-4 py-2 lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 mono-sm text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {flush.phase === "encrypting"
                ? "encrypting locally"
                : flush.phase === "submitted"
                  ? "submitted — waiting for the chain to confirm"
                  : cfg.mode === "wallet"
                    ? `${walletWaitText(elapsed, typicalWalletSeconds(), cfg.walletId ?? "the wallet")} · ${elapsed.toFixed(0)} s`
                    : `proving — ${Math.max(0, Math.ceil(total - elapsed))} s left. Real cryptography, not a loading screen.`}
            </span>
            {(flush.phase === "encrypting" || flush.phase === "proving") && cfg.mode === "demo" && (
              <button type="button" className="ml-auto inline-flex items-center gap-1 mono-sm text-destructive/80 hover:text-destructive" onClick={() => store.cancelFlush()}>
                <X size={12} aria-hidden="true" />
                cancel (before submission)
              </button>
            )}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-high" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {!proving && tiers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 lg:px-6">
          <span className="text-sm">
            <strong>Outbox · {tiers.length} message{tiers.length > 1 ? "s" : ""} queued</strong>{" "}
            <span className="mono-sm text-muted-foreground">
              ~{batchPreview(tiers, cfg.provingSeconds).seconds} s · {fmtUsd(batchPreview(tiers, cfg.provingSeconds).usd)} · one transaction per lane
            </span>
          </span>
          <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-on-primary hover:opacity-90" onClick={() => void store.sendBatch()}>
            <PaperPlaneTilt size={16} aria-hidden="true" />
            Send batch
          </button>
        </div>
      )}
      {flush.phase === "confirmed" && flush.txHash && (
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-sm text-ok lg:px-6">
          <CheckCircle size={16} aria-hidden="true" />
          batch confirmed · <TxLink hash={flush.txHash} />
        </div>
      )}
      {flush.phase === "failed" && (
        <div className="border-b border-border px-4 py-2 text-sm text-destructive lg:px-6">
          {tiers.length > 0 ? "last send failed — messages are back in the queue: " : "send failed: "}
          {flush.error}
        </div>
      )}
      <StatusFooter />
    </div>
  );
}

/** The confirmed transaction, as a link to the explorer when there is one. */
function TxLink({ hash }: { hash: string }) {
  if (!hash.startsWith("0x")) {
    return <span title="the wallet answered Timeout, but the message was found on-chain; the wallet did not return the hash">confirmed on-chain (hash held by the wallet)</span>;
  }
  const url = explorerTxUrl(store.config!, hash);
  const short = `tx ${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return url ? (
    <a className="underline underline-offset-2" href={url} target="_blank" rel="noreferrer" title={hash}>
      {short} ↗
    </a>
  ) : (
    <code title={hash}>{short}</code>
  );
}
