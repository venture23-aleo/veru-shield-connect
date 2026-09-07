import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  CurrencyDollar,
  Lock,
  ShareNetwork,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { makeInvite, stitchThread, type Contact } from "../lib/contacts.js";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";
import { PrivacyInfoButton } from "./privacy.js";

function monogram(label: string): string {
  const parts = label.replace(/^#/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export function ThreadView({
  contact,
  onBack,
  onPrivacy,
}: {
  contact: Contact;
  onBack?: () => void;
  onPrivacy?: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const [draft, setDraft] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [attachPayment, setAttachPayment] = useState(false);
  const history = store.engine?.history() ?? [];
  const thread = stitchThread(history, contact);
  const pending = store.pendingFor(contact.label);
  const preview = tierPreview(draft);
  const flush = store.flush;
  const cfg = store.config!;
  const provingLabel =
    cfg.provingMode === "self" ? "Generating proof on your device" : "Generating proof";

  const progressPct = (() => {
    if (flush.phase === "submitted") return 100;
    if (flush.phase === "encrypting") return 8;
    if (flush.phase === "proving" && flush.startedAt && flush.secondsTotal) {
      const elapsed = (Date.now() - flush.startedAt) / 1000;
      return Math.min(92, 8 + (elapsed / flush.secondsTotal) * 84);
    }
    return 0;
  })();

  const elapsed = flush.startedAt ? (Date.now() - flush.startedAt) / 1000 : 0;
  const total = flush.secondsTotal ?? cfg.provingSeconds;
  const queuedTiers = store.queuedTiers();
  const canSendBatch = queuedTiers.length > 0 && flush.phase === "idle";

  if (!contact.registered) {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <ThreadChrome contact={contact} onBack={onBack} onPrivacy={onPrivacy} />
        <div className="m-auto max-w-md rounded-xl border border-border bg-surface-lowest p-5">
          <h3 className="m-0 flex items-center gap-2 font-heading text-base font-semibold">
            <Warning size={20} className="text-warn" aria-hidden="true" />
            {contact.label} can’t receive messages yet
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            They haven’t registered a viewing key on the pool (<code>SetViewingKey</code>), so
            there is no key to encrypt to.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-border bg-surface-mid px-3 py-2 text-sm hover:border-primary/50"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `You've been invited to VeruShield Connect. Register a viewing key once, then messages to ${contact.peer} will start working.`
                )
              }
            >
              Copy invite for {contact.label}
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-surface-mid"
              onClick={() => void store.refreshRegistration(contact)}
            >
              Check again
            </button>
            {store.backend?.demo && (
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-surface-mid"
                onClick={() => store.simulatePeerRegistration(contact)}
              >
                (demo: simulate their registration)
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const queueDraft = () => {
    if (!draft.trim() || !preview.tier || attachPayment) return;
    store.queue(contact, draft);
    setDraft("");
  };

  const sendOrQueue = () => {
    if (draft.trim() && preview.tier && !attachPayment) {
      store.queue(contact, draft);
      setDraft("");
    }
    if (store.queuedTiers().length > 0 && (flush.phase === "idle" || flush.phase === "confirmed" || flush.phase === "failed")) {
      void store.sendBatch();
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      <ThreadChrome
        contact={contact}
        onBack={onBack}
        onPrivacy={onPrivacy}
        inviteCopied={inviteCopied}
        onCopyInvite={() => {
          void navigator.clipboard.writeText(
            JSON.stringify(makeInvite(contact, store.config!.accountAddress), null, 2)
          );
          setInviteCopied(true);
          setTimeout(() => setInviteCopied(false), 1500);
        }}
      />

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 lg:px-6">
        <div className="flex items-center justify-center">
          <div className="flex items-center gap-1.5 rounded-full bg-surface-high px-3 py-0.5 mono-sm text-muted-foreground">
            <Lock size={12} aria-hidden="true" />
            TODAY · SESSION ROOT
            {store.engine?.status()?.syncedToBlock != null
              ? ` #${store.engine.status()!.syncedToBlock!.toLocaleString()}`
              : ""}
          </div>
        </div>

        {thread.length === 0 && pending.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            No messages yet. Write one below — it queues into the outbox.
          </p>
        )}

        {thread.map((m) => (
          <div
            key={`${m.channelKey}:${m.index}`}
            className={`flex max-w-2xl flex-col gap-1 ${
              m.direction === "sent" ? "ml-auto items-end" : "items-start"
            }`}
          >
            <div className="flex items-center gap-1.5">
              {m.direction === "received" && (
                <span className="mono-sm font-medium text-secondary">{contact.label}</span>
              )}
              <span className="text-xs text-outline">
                {new Date(m.timestamp * 1000).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {m.direction === "sent" ? (
                <span className="mono-sm font-medium text-primary">Shielded Identity</span>
              ) : (
                <span className="mono-sm rounded bg-primary/10 px-1.5 text-primary">ZK Verified</span>
              )}
            </div>
            <div
              className={`rounded-2xl p-4 shadow-sm ${
                m.direction === "sent"
                  ? "rounded-tr-sm bg-surface-mid"
                  : "rounded-tl-sm bg-surface-low"
              }`}
            >
              <p className="text-sm leading-relaxed text-foreground">{m.body}</p>
              {m.direction === "received" && (
                <div className="mt-2 flex items-center justify-between pt-1 mono-sm text-muted-foreground">
                  <span className="text-secondary select-all">
                    Payload · {shorten(contact.peer)}
                  </span>
                  <span className="flex items-center gap-1 font-medium text-primary">
                    <CheckCircle size={12} weight="fill" aria-hidden="true" />
                    Verified Shielded Payload
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {pending.map((e, i) => {
          const status =
            e.status === "proving" && flush.phase === "encrypting" ? "encrypting" : e.status;
          const isProving =
            status === "proving" || status === "encrypting" || status === "submitted";
          const isQueued = status === "queued";
          return (
            <div key={e.id} className="ml-auto flex w-full max-w-3xl flex-col items-end gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-outline">
                  {new Date(e.queuedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="mono-sm font-medium text-primary">
                  {isQueued ? "Pending Queue" : "Shielded Identity"}
                </span>
                {isProving && (
                  <span className="mono-sm rounded bg-tertiary-container px-1.5 font-medium text-on-tertiary-container">
                    ZK Proof in Progress
                  </span>
                )}
              </div>
              <div
                className={`relative w-full overflow-hidden rounded-2xl rounded-tr-sm p-4 shadow-md ${
                  isQueued ? "bg-surface-low text-muted-foreground" : "bg-surface-mid text-foreground"
                }`}
              >
                <p className="text-sm leading-relaxed text-foreground">{e.body}</p>

                {isProving && (
                  <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-surface-lowest p-4">
                    <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                        <span className="mono-sm font-medium text-foreground">
                          {flush.phase === "encrypting"
                            ? "Phase 1 of 4: Encrypting locally"
                            : flush.phase === "submitted"
                              ? "Phase 3 of 4: Submitting to pool"
                              : cfg.provingMode === "self"
                                ? "Phase 2 of 4: Local WASM STARK proving"
                                : "Phase 2 of 4: Hosted proof generation"}
                        </span>
                      </div>
                      <span className="mono-sm font-semibold text-primary">
                        {provingLabel} — elapsed {elapsed.toFixed(1)}s
                      </span>
                    </div>
                    <div
                      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-high"
                      role="progressbar"
                      aria-valuenow={Math.round(progressPct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-primary shadow-[0_0_12px_rgba(0,229,163,0.5)] transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-y-1 rounded bg-surface-low p-1.5 mono-sm text-muted-foreground">
                      <span>
                        WASM Prover: <strong className="font-normal text-foreground">gates active</strong>
                      </span>
                      <span>
                        Est. total: <strong className="font-normal text-secondary">~{total}s</strong>
                      </span>
                      <span>
                        Mode:{" "}
                        <strong className="font-normal text-foreground">
                          {cfg.provingMode === "self" ? "self-hosted" : "hosted"}
                        </strong>
                      </span>
                      <span className="font-medium text-primary">Client deterministic ZK runtime</span>
                    </div>
                    <div className="flex items-center justify-between pt-0.5">
                      <span className="mono-sm text-outline">
                        {flush.phase === "submitted"
                          ? "Cancel no longer available after mempool submission"
                          : "Deterministic witness calculation active"}
                      </span>
                      {(flush.phase === "encrypting" || flush.phase === "proving") && i === 0 && (
                        <button
                          type="button"
                          className="mono-sm text-destructive/80 underline underline-offset-4 hover:text-destructive"
                          onClick={() => store.cancelFlush()}
                        >
                          ✕ Cancel proof (before mempool submission)
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isQueued && (
                  <div className="mt-2 flex items-center justify-between pt-1 mono-sm">
                    <span className="flex items-center gap-1 font-medium text-tertiary-dim">
                      ⏳ Queued (waiting for preceding proof / batch send)
                    </span>
                    <span className="text-outline">Pipe ID: #{e.id.slice(-4)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer — Stitch payment memo + Send / Prove */}
      <div className="flex flex-col gap-2.5 bg-surface-lowest p-4">
        {attachPayment && (
          <div className="flex flex-col gap-2.5 rounded-xl bg-surface-low p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <CurrencyDollar size={18} className="text-primary" aria-hidden="true" />
                <span className="text-lg font-semibold text-foreground">
                  Shielded Payment Memo Payload
                </span>
                <span className="mono-sm rounded bg-primary px-1.5 py-0.5 font-medium text-on-primary">
                  Atomic Bundle
                </span>
              </div>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setAttachPayment(false)}
              >
                <X size={14} aria-hidden="true" />
                Detach Memo
              </button>
            </div>
            <div className="rounded-lg border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn">
              Payment attach needs a live pool transfer in the same <code>InvokeExternal</code>; not
              available in this demo build. Send as a plain message instead.
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5 mono-sm text-muted-foreground">
          <div className="flex items-center gap-1 text-outline">
            <Lock size={12} aria-hidden="true" />
            Encrypted · visible to auditor under lawful process{" "}
            <span className="text-tertiary-dim">[Key Custody: Split Escrow]</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-outline">
              {preview.tier
                ? `${preview.tier} B tier · ${fmtUsd(preview.usd ?? 0)}`
                : draft
                  ? `too long by ${preview.overBy} bytes`
                  : "Max Memo: tiered"}
            </span>
            <span className="text-primary">Shielded Session Active</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 mono-sm transition-colors ${
              attachPayment
                ? "bg-primary/15 font-medium text-primary"
                : "bg-surface-mid text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setAttachPayment((v) => !v)}
            aria-pressed={attachPayment}
          >
            <CurrencyDollar size={12} aria-hidden="true" />
            {attachPayment ? "Payment memo attached" : "Attach payment"}
          </button>
          {canSendBatch && (
            <span className="mono-sm shrink-0 rounded-full bg-surface-mid px-2.5 py-0.5 text-secondary">
              Outbox · {queuedTiers.length} queued
            </span>
          )}
          <span className="mono-sm shrink-0 rounded-full bg-surface-mid px-2.5 py-0.5 text-outline">
            Via {cfg.submissionMode === "paymaster" ? "Paymaster relay" : "Direct submit"}
          </span>
        </div>

        <form
          className="flex items-end gap-2.5 rounded-xl bg-surface-low p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            sendOrQueue();
          }}
        >
          <textarea
            className="flex-1 resize-none bg-transparent px-0.5 text-sm text-foreground outline-none placeholder:text-outline"
            rows={2}
            placeholder={`Write an encrypted message to ${contact.label}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendOrQueue();
              }
            }}
          />
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md transition-opacity hover:opacity-90 disabled:opacity-45"
            disabled={
              attachPayment ||
              ((!draft.trim() || !preview.tier) && !canSendBatch) ||
              flush.phase === "encrypting" ||
              flush.phase === "proving" ||
              flush.phase === "submitted"
            }
          >
            Send / Prove
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
}

function ThreadChrome({
  contact,
  onBack,
  onPrivacy,
  inviteCopied,
  onCopyInvite,
}: {
  contact: Contact;
  onBack?: () => void;
  onPrivacy?: () => void;
  inviteCopied?: boolean;
  onCopyInvite?: () => void;
}) {
  const cfg = store.config;
  return (
    <header className="flex h-16 items-center justify-between gap-3 bg-surface-lowest/80 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {onBack && (
          <button
            type="button"
            className="mr-1 inline-flex items-center rounded-lg p-1.5 text-muted-foreground hover:bg-surface-mid hover:text-foreground md:hidden"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        )}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-high font-mono text-xs font-bold text-primary">
          {monogram(contact.label)}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-lg font-semibold text-foreground">{contact.label}</span>
            <span className="label-caps flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Shielded Session
            </span>
            <span className="mono-sm rounded bg-surface-high px-1.5 py-0.5 text-secondary">
              View Key Verified
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 truncate mono-sm text-muted-foreground">
            <button
              type="button"
              className="hover:underline"
              title={contact.peer}
              onClick={() => void navigator.clipboard.writeText(contact.peer)}
            >
              Channel: <strong className="font-normal text-foreground">{shorten(contact.peer)}</strong>
            </button>
            <span>·</span>
            <span>
              Auditor Escrow: <strong className="font-normal text-tertiary-dim">#AE-39</strong>
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onCopyInvite && (
          <button
            type="button"
            className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-surface-mid hover:text-foreground sm:inline-flex"
            onClick={onCopyInvite}
          >
            {inviteCopied ? (
              <>
                <CheckCircle size={14} aria-hidden="true" />
                invite copied
              </>
            ) : (
              <>
                <ShareNetwork size={14} aria-hidden="true" />
                copy invite
              </>
            )}
          </button>
        )}
        {onPrivacy && <PrivacyInfoButton onOpen={onPrivacy} />}
        <div className="hidden items-center gap-1.5 rounded-full bg-surface-low px-2.5 py-1 sm:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span className="mono-sm text-foreground">
            {cfg?.provingMode === "self" ? "Local WASM Prover active" : "Hosted Prover active"}
          </span>
        </div>
      </div>
    </header>
  );
}
