import { useEffect, useState } from "react";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

/**
 * Sync state is first-class chrome (12-client-and-ui.md): a stale view renders
 * as "no new messages", which is the worst failure mode for a messenger — so
 * the block watermark lives in the header, not in a settings pane.
 */
/**
 * Your address, one click to copy — it's what other people enter under
 * "+ add" to reach you, so it should never require digging through files.
 */
function IdentityChip() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="id-chip"
      title={`your messaging identity — click to copy:\n${store.identity}${
        store.config?.identityAddress ? `\nsigner: ${store.config.accountAddress}` : "\n(also the signer)"
      }`}
      onClick={() => {
        void navigator.clipboard.writeText(store.identity);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "address copied ✓" : (
        <>
          you: <code>{shorten(store.identity)}</code> ⧉
        </>
      )}
    </button>
  );
}

/**
 * Pool mode: nobody can write to you until your viewing key is on the pool.
 * Sends bundle registration, but a send needs a registered recipient — so
 * the first two people would wait for each other forever. Hence a
 * registration-only transaction, offered until it has happened.
 */
function RegistrationBanner() {
  if (store.isPool && store.viewingKeyMismatch) {
    return (
      <div className="register-banner mismatch">
        <span>
          <strong>Wrong viewing key for this account.</strong> The pool has a different key
          registered for <code>{shorten(store.identity)}</code> than the one in Settings.
          Everything derives from it, so discovery will find nothing and nobody can reach you
          — paste the key you registered with (Settings → Pool → Viewing key).
        </span>
      </div>
    );
  }
  if (!store.isPool || store.selfRegistered !== false) return null;
  const busy = store.flush.phase === "proving" || store.flush.phase === "submitted";
  return (
    <div className="register-banner">
      <span>
        <strong>Not registered on the pool yet.</strong> Until your viewing key is on the pool
        (<code>SetViewingKey</code>), nobody can write to you — one transaction, your account
        pays the pool fee.
      </span>
      <button className="primary" disabled={busy} onClick={() => void store.registerSelf()}>
        {busy ? "registering…" : "Register on the pool"}
      </button>
    </div>
  );
}

/**
 * What the signing account can spend, live: a send is ~2.5 STRK of gas plus
 * the pool fee, and the gateway refuses outright when the balance cannot
 * cover the worst case — better to see it coming than to read it in a
 * failure bar.
 */
function BalanceChip() {
  const cfg = store.config;
  if (!cfg || cfg.mode === "demo") return null;
  const bal = store.strkBalance;
  if (bal === null) return <span className="hint">balance …</span>;
  const need = (store.poolFee ?? 0) + 3; // fee + gas headroom
  const low = cfg.mode === "pool" && bal < need;
  return (
    <span
      className={`balance-chip ${low ? "low" : ""}`}
      title={
        cfg.mode === "pool"
          ? `${bal.toLocaleString()} STRK on ${cfg.accountAddress}\npool fee ${store.poolFee ?? "?"} STRK per transaction + ~2.5 STRK gas per send${low ? " — too low to send, top up" : ""}`
          : `${bal.toLocaleString()} STRK on ${cfg.accountAddress}`
      }
      onClick={() => void store.refreshBalance()}
    >
      {bal.toLocaleString(undefined, { maximumFractionDigits: 2 })} STRK{low ? " · low" : ""}
    </span>
  );
}

export function Chrome({ onSettings }: { onSettings: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    // Auto-sync: incoming messages appear without hunting for a button. A
    // stale view rendering as "no new messages" is the failure mode to avoid.
    const s = setInterval(() => void store.syncNow(), 15000);
    const b = setInterval(() => void store.refreshBalance(), 30000);
    return () => {
      clearInterval(t);
      clearInterval(s);
      clearInterval(b);
    };
  }, []);

  const status = store.engine?.status();
  const age =
    status?.updatedAt != null ? Math.max(0, Math.round((Date.now() - status.updatedAt) / 1000)) : null;

  return (
    <header className="chrome">
      <div className="brand">STRK20 Messages</div>
      <IdentityChip />
      <BalanceChip />
      <button
        className={`sync ${store.syncing ? "busy" : ""}`}
        onClick={() => void store.syncNow()}
        title="Click to sync now"
      >
        {store.syncing
          ? "syncing…"
          : status?.syncedToBlock != null
            ? `synced to block ${status.syncedToBlock.toLocaleString()} · ${age}s ago`
            : "not synced yet"}
      </button>
      {store.isPool && store.selfRegistered && (
        <span className="hint" title="Your viewing key is on the pool: people can write to you">
          registered ✓
        </span>
      )}
      <button className="ghost" onClick={onSettings}>
        Settings
      </button>
      <RegistrationBanner />
    </header>
  );
}
