import { ArrowLeft, CheckCircle, CurrencyDollar, Lock, PaperPlaneTilt, Receipt, ShareNetwork, Warning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { decimalsOf, describeAmount, isStrk, parseAmount, STRK_TOKEN } from "../lib/amounts.js";
import { makeInvite, stitchThread, type Contact, type ThreadMessage } from "../lib/contacts.js";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { store } from "../lib/store.js";
import { typicalWalletSeconds, walletWaitText } from "../lib/walletBackend.js";
import { shorten } from "./Onboarding.js";
import { PrivacyInfoButton } from "./privacy.js";
import { networkLabel } from "./WorkspaceShell.js";

type PanelMode = "pay" | "request";
/** "channelKey:index" → whether an unspent note of that amount sits in our pool balance. */
type Receipts = Map<string, boolean>;

function monogram(label: string): string {
  const parts = label.replace(/^#/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export function ThreadView({ contact, onBack, onPrivacy }: { contact: Contact; onBack?: () => void; onPrivacy?: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const [draft, setDraft] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [panel, setPanel] = useState<PanelMode | null>(null);
  // STRK by default — the same address on Sepolia, mainnet and devnet — unless
  // the connection names another carrier token.
  const [payToken, setPayToken] = useState(store.config?.carrierToken || STRK_TOKEN);
  const [payAmount, setPayAmount] = useState("");
  const pool = store.isPool;
  const walletMode = store.config?.mode === "wallet";
  const canPay = store.canPay;
  const flush = store.flush;
  const cfg = store.config!;
  const busy = flush.phase === "proving" || flush.phase === "submitted" || flush.phase === "encrypting";
  const [inPool, setInPool] = useState<bigint | "checking" | null>(null);
  const [maturing, setMaturing] = useState<{ amount: bigint; blocks: number } | null>(null);
  const [shieldAmount, setShieldAmount] = useState("");
  const [receipts, setReceipts] = useState<Receipts>(new Map());
  const [simulation, setSimulation] = useState<{ method: string; ok: boolean; detail: string }[] | "running" | null>(null);
  const canSimulate = !!store.backend?.pool?.simulate;
  const lastTx = flush.phase === "confirmed" ? flush.txHash : undefined;
  const decimals = decimalsOf(payToken);
  const amountUnits = parseAmount(payAmount, decimals);

  useEffect(() => {
    if (panel !== "pay" || !canPay || !/^0x[0-9a-fA-F]+$/.test(payToken.trim())) return;
    let cancelled = false;
    setInPool("checking");
    store.backend!.pool!.poolNotes(payToken.trim()).then(
      (r) => {
        if (cancelled) return;
        setInPool(r.spendable);
        setMaturing(r.maturing > 0n ? { amount: r.maturing, blocks: r.maturesInBlocks } : null);
      },
      () => !cancelled && setInPool(null)
    );
    return () => {
      cancelled = true;
    };
  }, [panel, payToken, canPay, lastTx]);

  const history = store.engine?.history() ?? [];
  const thread = stitchThread(history, contact);
  const pending = store.pendingFor(contact.label);
  const preview = tierPreview(draft);
  const received = thread.filter((m) => m.direction === "received" && m.payment);
  const receivedSig = received.map((m) => `${m.channelKey}:${m.index}`).join(",");

  // Receipt check: a received memo says "I paid you X"; the pool's discovery
  // says which notes are ours. Pair them by amount, oldest memo first — the
  // chain never links a memo to a note, so this is the recipient's own proof.
  useEffect(() => {
    if (!canPay || received.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Receipts = new Map();
      const tokens = [...new Set(received.map((m) => m.payment!.token.toLowerCase()))];
      for (const token of tokens) {
        let notes: bigint[] = [];
        try {
          const list = await store.backend!.pool!.notes(token);
          if (list === null) continue; // this backend cannot enumerate notes (wallet API): no receipt line
          notes = list.map((n) => n.amount);
        } catch {
          continue;
        }
        for (const m of received.filter((x) => x.payment!.token.toLowerCase() === token)) {
          const i = notes.findIndex((n) => n === BigInt(m.payment!.amount));
          if (i >= 0) notes.splice(i, 1);
          next.set(`${m.channelKey}:${m.index}`, i >= 0);
        }
      }
      if (!cancelled) setReceipts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [canPay, receivedSig, lastTx]); // eslint-disable-line react-hooks/exhaustive-deps

  const elapsed = flush.startedAt ? (Date.now() - flush.startedAt) / 1000 : 0;
  const total = flush.secondsTotal ?? cfg.provingSeconds;
  const progressPct = flush.phase === "submitted" ? 100 : flush.phase === "encrypting" ? 8 : flush.phase === "proving" ? Math.min(92, 8 + (elapsed / total) * 84) : 0;

  const header = (
    <header className="flex h-16 items-center justify-between gap-3 bg-surface-lowest/80 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {onBack && (
          <button type="button" className="mr-1 inline-flex items-center rounded-lg p-1.5 text-muted-foreground hover:bg-surface-mid hover:text-foreground md:hidden" onClick={onBack} aria-label="Back to conversations">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        )}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-high font-mono text-xs font-bold text-primary">{monogram(contact.label)}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-lg font-semibold text-foreground">{contact.label}</span>
            <span className="label-caps flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 tracking-wider text-primary">
              <Lock size={10} aria-hidden="true" />
              end-to-end encrypted
            </span>
            <span className="mono-sm rounded bg-surface-high px-1.5 py-0.5 text-secondary">permanent</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 truncate mono-sm text-muted-foreground">
            <button type="button" className="hover:underline" title={`${contact.peer} — click to copy`} onClick={() => void navigator.clipboard.writeText(contact.peer)}>
              {shorten(contact.peer)}
            </button>
            <span>·</span>
            <span className="truncate">
              {pool
                ? contact.inKey
                  ? "you pay publicly; who and how much stay private"
                  : "their lane to you appears once they write or pay you"
                : walletMode
                  ? "each message carries a 1 wei note, proved and signed by your wallet"
                  : contact.derived
                    ? "address-paired lane"
                    : "invite-paired lane"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!pool && (
          <button
            type="button"
            className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-surface-mid hover:text-foreground sm:inline-flex"
            title="Copy an invite for the other person — they paste it under 'add' on their side and the thread pairs up"
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(makeInvite(contact, store.config!.accountAddress), null, 2));
              setInviteCopied(true);
              setTimeout(() => setInviteCopied(false), 1500);
            }}
          >
            {inviteCopied ? <CheckCircle size={14} aria-hidden="true" /> : <ShareNetwork size={14} aria-hidden="true" />}
            {inviteCopied ? "invite copied" : "copy invite"}
          </button>
        )}
        {onPrivacy && <PrivacyInfoButton onOpen={onPrivacy} />}
      </div>
    </header>
  );

  // The unregistered-recipient flow: a hard failure at compose time, designed
  // rather than erroring (12-client-and-ui.md).
  if (!contact.registered) {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {header}
        <div className="legacy m-auto max-w-md rounded-xl border border-border bg-surface-lowest p-5">
          <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
            <Warning size={20} className="text-warn" aria-hidden="true" />
            {contact.label} can’t receive messages yet
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            They haven’t registered a viewing key on the pool (<code>SetViewingKey</code>), so there is no key to encrypt to — and, in pool mode, no channel key to derive. Nothing you write can reach them until they do.
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={() => void navigator.clipboard.writeText(`You've been invited to VeruShield Connect. Register a viewing key on the STRK20 pool once (shield any amount in Ready X), then messages to ${contact.peer} will start working.`)}>
              Copy invite for {contact.label}
            </button>
            <button className="ghost" onClick={() => void store.refreshRegistration(contact)}>
              Check again
            </button>
            {store.backend?.demo && (
              <button className="ghost" onClick={() => store.simulatePeerRegistration(contact)}>
                (demo: simulate their registration)
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const queueDraft = () => {
    if (!draft.trim() || !preview.tier) return;
    store.queue(contact, draft);
    setDraft("");
  };
  const sendNow = () => {
    if (draft.trim() && preview.tier) {
      store.queue(contact, draft);
      setDraft("");
    }
    if (store.queuedTiers().length > 0 && !busy) void store.sendBatch();
  };

  /** Pre-fill the pay panel from a request they sent. */
  const payRequest = (m: ThreadMessage) => {
    const req = m.request!;
    setPayToken(req.token);
    setPayAmount(formatUnits(req.amount, decimalsOf(req.token)));
    setDraft(req.settledBy === undefined && m.body ? `for: ${m.body}` : draft);
    setPanel("pay");
  };
  const openPanel = (mode: PanelMode) => setPanel(panel === mode ? null : mode);
  const amountLabel = decimals > 0 ? "amount in STRK, e.g. 2.5" : "amount (smallest unit)";

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      {header}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 lg:px-6">
        {thread.length === 0 && pending.length === 0 && (
          <p className="mx-auto max-w-md text-center text-sm text-muted-foreground">
            {pool
              ? `Pool mode: pairing happens through the pool itself. Your first message or payment opens the channel; ${contact.label} discovers it on their side.`
              : contact.derived
                ? `Address-paired thread: ${contact.label} connects by adding your address ${shorten(store.identity)} — no invite needed. Anyone who guesses the pair can derive the lane; prefer an invite when the pairing itself should stay confidential.`
                : "No messages yet. Write one below."}
          </p>
        )}

        {thread.map((m) => {
          const key = `${m.channelKey}:${m.index}`;
          const receipt = receipts.get(key);
          const value = m.payment || m.request;
          return (
            <div key={key} className={`flex max-w-2xl flex-col gap-1 ${m.direction === "sent" ? "ml-auto items-end" : "items-start"}`}>
              <div className="flex items-center gap-1.5">
                <span className={`mono-sm font-medium ${m.direction === "sent" ? "text-primary" : "text-secondary"}`}>{m.direction === "sent" ? "you" : contact.label}</span>
                <span className="text-xs text-outline">{new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className={`rounded-2xl p-4 shadow-sm ${m.direction === "sent" ? "rounded-tr-sm bg-surface-mid" : "rounded-tl-sm bg-surface-low"} ${value ? "border border-primary/25" : ""}`}>
                {m.payment && (
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-primary" title={m.payment.token}>
                    <CurrencyDollar size={14} aria-hidden="true" />
                    {m.direction === "sent" ? "you paid" : "you received"} {describeAmount(m.payment.amount, m.payment.token)}
                  </div>
                )}
                {m.request && (
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-tertiary-dim" title={m.request.token}>
                    <Receipt size={14} aria-hidden="true" />
                    {m.direction === "sent" ? "you requested" : `${contact.label} requests`} {describeAmount(m.request.amount, m.request.token)}
                  </div>
                )}
                {m.body && <p className="text-sm leading-relaxed text-foreground">{m.body}</p>}
                {m.request && (
                  <div className="mt-2 flex items-center gap-2">
                    {m.request.settledBy !== undefined ? (
                      <span className="inline-flex items-center gap-1 mono-sm font-medium text-ok">
                        <CheckCircle size={12} weight="fill" aria-hidden="true" />
                        paid
                      </span>
                    ) : m.direction === "received" && canPay ? (
                      <button type="button" className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-on-primary hover:opacity-90 disabled:opacity-45" disabled={busy} onClick={() => payRequest(m)}>
                        Pay {describeAmount(m.request.amount, m.request.token)}
                      </button>
                    ) : (
                      <span className="mono-sm text-muted-foreground">{m.direction === "received" ? "paying needs pool or wallet mode" : `waiting for ${contact.label} to pay`}</span>
                    )}
                  </div>
                )}
                {m.payment && m.direction === "received" && canPay && receipts.has(key) && (
                  <div className={`mt-2 mono-sm ${receipt ? "text-ok" : "text-warn"}`}>
                    {receipt ? "✓ receipt: an unspent note of this amount is in your pool balance" : "receipt: no matching unspent note yet (still indexing, or already spent)"}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {pending.map((e, i) => {
          const status = e.status === "proving" && flush.phase === "encrypting" ? "encrypting" : e.status;
          const isProving = status === "proving" || status === "encrypting" || status === "submitted";
          const isQueued = status === "queued";
          return (
            <div key={e.id} className="ml-auto flex w-full max-w-2xl flex-col items-end gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-outline">{new Date(e.queuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="mono-sm font-medium text-primary">{isQueued ? "queued" : "you"}</span>
                {isProving && <span className="mono-sm rounded bg-tertiary-container px-1.5 font-medium text-on-tertiary-container">{status === "submitted" ? "submitted" : "proving"}</span>}
              </div>
              <div className={`relative w-full overflow-hidden rounded-2xl rounded-tr-sm p-4 shadow-md ${isQueued ? "bg-surface-low text-muted-foreground" : "bg-surface-mid text-foreground"}`}>
                <p className="text-sm leading-relaxed">{e.body.startsWith("REQ1 ") ? "payment request" : e.body}</p>
                {isProving && (
                  <div className="mt-3 flex flex-col gap-2 rounded-xl bg-surface-lowest p-3">
                    <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                      <span className="flex items-center gap-1.5 mono-sm font-medium text-foreground">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                        {flush.phase === "encrypting" ? "encrypting locally" : flush.phase === "submitted" ? "submitted — waiting for the chain" : walletMode ? walletWaitText(elapsed, typicalWalletSeconds(), cfg.walletId ?? "the wallet") : "generating the proof"}
                      </span>
                      <span className="mono-sm font-semibold text-primary">{elapsed.toFixed(0)} s of ~{total} s</span>
                    </div>
                    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-high" role="progressbar" aria-valuenow={Math.round(progressPct)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="mono-sm text-outline">{flush.phase === "submitted" ? "cancel is no longer possible after submission" : "real cryptography, not a loading screen"}</span>
                      {(flush.phase === "encrypting" || flush.phase === "proving") && i === 0 && cfg.mode === "demo" && (
                        <button type="button" className="mono-sm text-destructive/80 underline underline-offset-4 hover:text-destructive" onClick={() => store.cancelFlush()}>
                          cancel (before submission)
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {isQueued && <div className="mt-2 mono-sm text-tertiary-dim">queued — sends with the next batch</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="legacy flex flex-col gap-2.5 bg-surface-lowest p-4">
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5 mono-sm text-muted-foreground">
          <span className="flex items-center gap-1 text-outline">
            <Lock size={12} aria-hidden="true" />
            Encrypted end-to-end · visible to an auditor under lawful process
          </span>
          <span className="text-outline">
            {preview.tier ? `${preview.tier} B tier · ${fmtUsd(preview.usd ?? 0)}` : draft ? `too long by ${preview.overBy} bytes` : ""}
            {preview.boundary ? ` · ${preview.boundary.bytesLeft} more bytes → next tier (+${fmtUsd(preview.boundary.extraUsd)})` : ""}
            {(pool || walletMode) && store.poolFee !== null ? ` · each send: ${store.poolFee} STRK pool fee + gas${networkLabel() === "mainnet" ? " · real funds" : ""}` : ""}
          </span>
        </div>

        {canPay && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <Chip active={panel === "pay"} disabled={busy} onClick={() => openPanel("pay")} icon={<CurrencyDollar size={12} aria-hidden="true" />} label={panel === "pay" ? "cancel payment" : "send STRK"} />
            <Chip active={panel === "request"} disabled={busy} onClick={() => openPanel("request")} icon={<Receipt size={12} aria-hidden="true" />} label={panel === "request" ? "cancel request" : "request payment"} />
            {store.queuedTiers().length > 0 && <span className="mono-sm shrink-0 rounded-full bg-surface-mid px-2.5 py-0.5 text-secondary">Outbox · {store.queuedTiers().length} queued</span>}
          </div>
        )}

        <form
          className="flex items-end gap-2.5 rounded-xl bg-surface-low p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (panel === null) sendNow();
          }}
        >
          <textarea
            className="flex-1 resize-none bg-transparent px-0.5 text-sm text-foreground outline-none placeholder:text-outline"
            style={{ border: 0, background: "transparent" }}
            rows={2}
            placeholder={panel === "pay" ? "Memo for the payment (private, rides in the same transaction)…" : panel === "request" ? "What is it for? (goes with the request)…" : `Write an encrypted message to ${contact.label}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && panel === null) {
                e.preventDefault();
                sendNow();
              }
            }}
          />
          {panel === null && (
            <>
              <button type="button" className="ghost" title="Queue only — several messages send as one transaction" disabled={!draft.trim() || !preview.tier} onClick={queueDraft}>
                queue
              </button>
              <button type="submit" className="primary" disabled={((!draft.trim() || !preview.tier) && store.queuedTiers().length === 0) || busy}>
                <span className="inline-flex items-center gap-1.5">
                  <PaperPlaneTilt size={16} aria-hidden="true" />
                  Send
                </span>
              </button>
            </>
          )}
        </form>

        {canPay && panel && (
          <div className="pay-panel">
            <span className="row" style={{ flex: 1, minWidth: 220 }}>
              <input className="mono" placeholder="token 0x…" value={payToken} onChange={(e) => setPayToken(e.target.value)} />
              {isStrk(payToken) ? <span className="hint" style={{ flexBasis: "auto" }}>STRK</span> : <button className="ghost small" title="Use STRK" onClick={() => setPayToken(STRK_TOKEN)}>STRK</button>}
            </span>
            <input className="mono" placeholder={amountLabel} value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(decimals > 0 ? /[^0-9.]/g : /[^0-9]/g, ""))} />
            {amountUnits !== null && <span className="hint" style={{ flexBasis: "auto" }}>= {describeAmount(amountUnits, payToken)}</span>}

            {panel === "pay" && (
              <>
                <span className={typeof inPool === "bigint" && inPool === 0n ? "probe-err" : "hint"} style={{ flexBasis: "100%" }}>
                  {inPool === "checking"
                    ? "reading your notes in the pool…"
                    : typeof inPool === "bigint"
                      ? `in pool: ${describeAmount(inPool, payToken)} spendable${maturing ? ` (+${describeAmount(maturing.amount, payToken)} maturing — ~${maturing.blocks} more block${maturing.blocks === 1 ? "" : "s"})` : ""}${pool ? ` · wallet: ${store.strkBalance ?? "?"} STRK` : ""} — a payment spends notes INSIDE the pool, not the wallet${inPool === 0n && !maturing ? (pool ? ". You hold none: shield below (on Sepolia deposits need the operator's screening prover — Settings)." : ".") : "."}`
                      : ""}
                </span>
                {(pool || walletMode) && (
                  <span className="row" style={{ flexBasis: "100%" }}>
                    <input className="mono" placeholder="shield: amount in STRK (public → private)" value={shieldAmount} onChange={(e) => setShieldAmount(e.target.value.replace(/[^0-9.]/g, ""))} style={{ maxWidth: 260 }} />
                    <button
                      disabled={busy || parseAmount(shieldAmount, 18) === null}
                      title="Approve the pool, then a proven Deposit — creates a private note you can pay from"
                      onClick={() => {
                        const wei = parseAmount(shieldAmount, 18)!;
                        setShieldAmount("");
                        void store.shield(payToken.trim(), wei);
                      }}
                    >
                      Shield
                    </button>
                    <span className="hint" style={{ flexBasis: "auto" }}>{walletMode ? "the wallet builds, screens and signs the deposit" : "deposits are screened by the pool"}</span>
                  </span>
                )}
                <button
                  className="primary"
                  disabled={busy || !/^0x[0-9a-fA-F]+$/.test(payToken) || amountUnits === null || (typeof inPool === "bigint" && amountUnits > inPool)}
                  onClick={() => {
                    const memo = draft;
                    setDraft("");
                    setPanel(null);
                    setPayAmount("");
                    void store.pay(contact, payToken.trim(), amountUnits!, memo);
                  }}
                >
                  Pay {amountUnits !== null ? describeAmount(amountUnits, payToken) : ""} & send memo
                </button>
                {canSimulate && (
                  <button
                    className="ghost"
                    disabled={busy || simulation === "running" || !/^0x[0-9a-fA-F]+$/.test(payToken) || amountUnits === null}
                    title="Ask the wallet to assemble this exact payment without proving or spending, whole and in halves — shows which part it refuses"
                    onClick={() => {
                      setSimulation("running");
                      void store.simulatePayment(contact, payToken.trim(), amountUnits!, draft).then(setSimulation, (e: unknown) => setSimulation([{ method: "simulate", ok: false, detail: e instanceof Error ? e.message : String(e) }]));
                    }}
                  >
                    {simulation === "running" ? "asking the wallet…" : "test this payment"}
                  </button>
                )}
                {Array.isArray(simulation) && (
                  <ul className="diag" style={{ flexBasis: "100%" }}>
                    {simulation.map((d) => (
                      <li key={d.method} className={d.ok ? "probe-ok" : "probe-err"}>
                        <code>{d.method}</code> → {d.detail}
                      </li>
                    ))}
                  </ul>
                )}
                <span className="hint">One transaction: the transfer and the memo confirm together or not at all. You are the public submitter; {contact.label} and the amount are not in the envelope.</span>
              </>
            )}

            {panel === "request" && (
              <>
                <button
                  className="primary"
                  disabled={!/^0x[0-9a-fA-F]+$/.test(payToken) || amountUnits === null}
                  onClick={() => {
                    store.queueRequest(contact, payToken.trim(), amountUnits!, draft.trim());
                    setDraft("");
                    setPanel(null);
                    setPayAmount("");
                  }}
                >
                  Request {amountUnits !== null ? describeAmount(amountUnits, payToken) : ""} → outbox
                </button>
                <span className="hint">A request is a message: it costs you no pool balance and sends with the next batch. {contact.label} sees a “Pay” button; their payment settles it here as “paid”.</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ active, disabled, onClick, icon, label }: { active: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 mono-sm transition-colors ${active ? "bg-primary/15 font-medium text-primary" : "bg-surface-mid text-muted-foreground hover:text-foreground"}`}
      style={{ border: 0 }}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

/** Smallest units → the string the amount box takes ("2.5" for STRK, digits otherwise). */
function formatUnits(amount: string, decimals: number): string {
  if (decimals === 0) return amount;
  const v = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / base}${frac ? "." + frac : ""}`;
}
