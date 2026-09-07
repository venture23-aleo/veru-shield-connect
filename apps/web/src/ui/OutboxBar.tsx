import { useEffect, useState } from "react";
import { batchPreview, fmtUsd } from "../lib/costs.js";
import { explorerTxUrl } from "../lib/explorer.js";
import { store } from "../lib/store.js";
import type { Bucket } from "@strk20-messaging/sdk";

/**
 * The batch is a control, not a spinner (12-client-and-ui.md): users tolerate
 * latency they can see coming and chose to trigger. Count, time and cost are
 * shown BEFORE the button is pressed; the ~29 s of proving runs as a visible,
 * honest progress bar afterwards.
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

  if (flush.phase === "proving" || flush.phase === "submitted") {
    const elapsed = flush.startedAt ? (Date.now() - flush.startedAt) / 1000 : 0;
    const total = flush.secondsTotal ?? 29;
    const pct = flush.phase === "submitted" ? 100 : Math.min(99, (elapsed / total) * 100);
    return (
      <footer className="outbox proving">
        <div className="states">
          <StateChip label="Queued" done />
          <StateChip label={`Proving (~${total} s)`} active={flush.phase === "proving"} done={flush.phase === "submitted"} />
          <StateChip label="Submitted" active={flush.phase === "submitted"} />
          <StateChip label="Confirmed" />
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="hint">
          {flush.phase === "proving"
            ? `proving the batch — ${Math.max(0, Math.ceil(total - elapsed))} s left. This is real cryptography, not a loading screen.`
            : "submitted — waiting for the chain to confirm…"}
        </span>
      </footer>
    );
  }

  if (tiers.length === 0) {
    return (
      <footer className="outbox idle">
        {flush.phase === "confirmed" && flush.txHash && (
          <span className="confirmed-note">
            ✓ batch confirmed · <TxLink hash={flush.txHash} />
          </span>
        )}
        {flush.phase === "failed" && <span className="error">send failed: {flush.error}</span>}
        {flush.phase === "idle" && <span className="hint">Outbox empty — drafts queue here and send as one batch.</span>}
      </footer>
    );
  }

  const preview = batchPreview(tiers, cfg.provingSeconds);
  return (
    <footer className="outbox ready">
      {flush.phase === "failed" && (
        <span className="error" style={{ flexBasis: "100%" }}>
          last send failed — messages are back in the queue: {flush.error}
        </span>
      )}
      <span>
        <strong>Outbox · {preview.count} message{preview.count > 1 ? "s" : ""} queued</strong>
        {"  "}~{preview.seconds} s · {fmtUsd(preview.usd)} · one transaction
      </span>
      <button className="primary" onClick={() => void store.sendBatch()}>
        Send batch
      </button>
    </footer>
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
    <a href={url} target="_blank" rel="noreferrer" title={hash}>
      {short} ↗
    </a>
  ) : (
    <code title={hash}>{short}</code>
  );
}

function StateChip({ label, active, done }: { label: string; active?: boolean; done?: boolean }) {
  return <span className={`chip ${active ? "active" : ""} ${done ? "done" : ""}`}>{label}</span>;
}
