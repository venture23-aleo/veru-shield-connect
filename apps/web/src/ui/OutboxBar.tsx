import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { batchPreview, fmtUsd } from "../lib/costs.js";
import { store } from "../lib/store.js";
import type { Bucket } from "@strk20-messaging/sdk";
import { StatusFooter } from "./WorkspaceShell.js";

/**
 * Batch control bar. When `compact`, proving UI lives in the thread bubble (Stitch)
 * and this only shows queue / send + status footer.
 */
export function OutboxBar({ compact = false }: { compact?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const tiers = store.queuedTiers() as Bucket[];
  const flush = store.flush;
  const cfg = store.config!;
  const proving =
    flush.phase === "encrypting" || flush.phase === "proving" || flush.phase === "submitted";

  if (compact) {
    return (
      <div className="border-t border-border bg-surface-lowest">
        {!proving && tiers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 lg:px-6">
            <span className="text-sm">
              <strong>
                Outbox · {tiers.length} message{tiers.length > 1 ? "s" : ""}
              </strong>
              {"  "}
              <span className="mono-sm text-muted-foreground">
                ~{batchPreview(tiers, cfg.provingSeconds).seconds}s ·{" "}
                {fmtUsd(batchPreview(tiers, cfg.provingSeconds).usd)}
              </span>
            </span>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-on-primary hover:opacity-90"
              onClick={() => void store.sendBatch()}
            >
              <PaperPlaneTilt size={16} aria-hidden="true" />
              Send batch
            </button>
          </div>
        )}
        {flush.phase === "confirmed" && flush.txHash && (
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-sm text-ok lg:px-6">
            <CheckCircle size={16} aria-hidden="true" />
            batch confirmed · tx <code>{flush.txHash.slice(0, 12)}…</code>
          </div>
        )}
        {flush.phase === "failed" && (
          <div className="border-b border-border px-4 py-2 text-sm text-destructive lg:px-6">
            send failed: {flush.error}
          </div>
        )}
        <StatusFooter />
      </div>
    );
  }

  // Legacy full bar (unused in shell; kept for safety)
  if (tiers.length === 0) {
    return (
      <footer className="flex min-h-[54px] flex-col gap-2 border-t border-border bg-surface-lowest px-4 py-3">
        <StatusFooter />
      </footer>
    );
  }

  const preview = batchPreview(tiers, cfg.provingSeconds);
  return (
    <footer className="flex min-h-[54px] flex-col gap-2 border-t border-primary bg-surface-lowest px-4 py-3">
      <div className="flex flex-wrap items-center gap-3.5">
        <span>
          <strong>
            Outbox · {preview.count} message{preview.count > 1 ? "s" : ""} queued
          </strong>
          {"  "}~{preview.seconds} s · {fmtUsd(preview.usd)} · one transaction
        </span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 font-semibold text-on-primary"
          onClick={() => void store.sendBatch()}
        >
          Send batch
        </button>
      </div>
    </footer>
  );
}
