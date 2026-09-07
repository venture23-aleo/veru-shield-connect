import { ArrowsClockwise, Copy, Gear } from "@phosphor-icons/react";
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
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors duration-200 hover:border-primary/50 hover:text-foreground"
      title={`your messaging identity — click to copy:\n${store.identity}${
        store.config?.identityAddress ? `\nsigner: ${store.config.accountAddress}` : "\n(also the signer)"
      }`}
      onClick={() => {
        void navigator.clipboard.writeText(store.identity);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <>
          <Copy size={14} weight="regular" aria-hidden="true" />
          address copied
        </>
      ) : (
        <>
          you: <code className="text-foreground">{shorten(store.identity)}</code>
          <Copy size={14} weight="regular" aria-hidden="true" />
        </>
      )}
    </button>
  );
}

export function Chrome({ onSettings }: { onSettings: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    // Auto-sync: incoming messages appear without hunting for a button. A
    // stale view rendering as "no new messages" is the failure mode to avoid.
    const s = setInterval(() => void store.syncNow(), 15000);
    return () => {
      clearInterval(t);
      clearInterval(s);
    };
  }, []);

  const status = store.engine?.status();
  const age =
    status?.updatedAt != null ? Math.max(0, Math.round((Date.now() - status.updatedAt) / 1000)) : null;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5">
      <div className="mr-auto flex items-center gap-2.5">
        <img
          src="/verushield-logo.svg"
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 rounded-md object-cover"
          draggable={false}
        />
        <div className="leading-tight">
          <div className="font-heading text-sm font-semibold tracking-tight text-foreground">
            VeruShield Connect
          </div>
          <div className="text-[11px] text-muted-foreground">encrypted on Starknet</div>
        </div>
      </div>
      <IdentityChip />
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors duration-200 ${
          store.syncing
            ? "border-primary text-primary"
            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
        }`}
        onClick={() => void store.syncNow()}
        title="Click to sync now"
      >
        <ArrowsClockwise
          size={14}
          weight="regular"
          className={store.syncing ? "animate-spin" : ""}
          aria-hidden="true"
        />
        {store.syncing
          ? "Checking for new messages…"
          : status?.syncedToBlock != null
            ? `synced to block ${status.syncedToBlock.toLocaleString()} · ${age}s ago`
            : "not synced yet"}
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
        onClick={onSettings}
        aria-label="Settings"
      >
        <Gear size={18} weight="regular" aria-hidden="true" />
        <span className="hidden sm:inline">Settings</span>
      </button>
    </header>
  );
}
