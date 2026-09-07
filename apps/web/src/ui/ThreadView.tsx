import { useEffect, useState } from "react";
import { decimalsOf, describeAmount, isStrk, parseAmount, STRK_TOKEN } from "../lib/amounts.js";
import { makeInvite, stitchThread, type Contact, type ThreadMessage } from "../lib/contacts.js";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

type PanelMode = "pay" | "request";

/** "channelKey:index" → whether an unspent note of that amount sits in our pool balance. */
type Receipts = Map<string, boolean>;

export function ThreadView({ contact }: { contact: Contact }) {
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
  const busy = store.flush.phase === "proving" || store.flush.phase === "submitted";
  const [inPool, setInPool] = useState<bigint | "checking" | null>(null);
  const [maturing, setMaturing] = useState<{ amount: bigint; blocks: number } | null>(null);
  const [shieldAmount, setShieldAmount] = useState("");
  const [receipts, setReceipts] = useState<Receipts>(new Map());
  const [simulation, setSimulation] = useState<{ method: string; ok: boolean; detail: string }[] | "running" | null>(null);
  const canSimulate = !!store.backend?.pool?.simulate;
  const lastTx = store.flush.phase === "confirmed" ? store.flush.txHash : undefined;
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
    // lastTx: re-read after a shield or payment confirms
  }, [panel, payToken, canPay, lastTx]);

  const history = store.engine?.history() ?? [];
  const thread = stitchThread(history, contact);
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
          continue; // discovery unreachable: leave these unmarked
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
    // receivedSig: the set of received payments; lastTx: our own spends move notes
  }, [canPay, receivedSig, lastTx]); // eslint-disable-line react-hooks/exhaustive-deps

  // The unregistered-recipient flow: a hard failure at compose time, designed
  // rather than erroring (12-client-and-ui.md).
  if (!contact.registered) {
    return (
      <div className="thread">
        <div className="thread-head">
          <strong>{contact.label}</strong> <code>{shorten(contact.peer)}</code>
        </div>
        <div className="unregistered">
          <h3>{contact.label} can’t receive messages yet</h3>
          <p>
            They haven’t registered a viewing key on the pool (<code>SetViewingKey</code>), so
            there is no key to encrypt to — and, in pool mode, no channel key to derive. Nothing
            you write can reach them until they do.
          </p>
          <div className="row">
            <button
              onClick={() =>
                void navigator.clipboard.writeText(
                  `You've been invited to STRK20 Messages. Register once at strk20.starknet.io and messages to ${contact.peer} will start working.`
                )
              }
            >
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

  /** Pre-fill the pay panel from a request they sent. */
  const payRequest = (m: ThreadMessage) => {
    const req = m.request!;
    setPayToken(req.token);
    setPayAmount(formatUnits(req.amount, decimalsOf(req.token)));
    setDraft(req.settledBy === undefined && m.body ? `for: ${m.body}` : draft);
    setPanel("pay");
  };

  const amountLabel = decimals > 0 ? "amount in STRK, e.g. 2.5" : "amount (smallest unit)";
  const openPanel = (mode: PanelMode) => {
    setPanel(panel === mode ? null : mode);
  };

  return (
    <div className="thread">
      <div className="thread-head">
        <strong>{contact.label}</strong> <code>{shorten(contact.peer)}</code>
        {!pool && (
          <button
            className="ghost"
            title="Copy an invite for the other person — they paste it into '+ add' on their side and the thread pairs up"
            onClick={() => {
              void navigator.clipboard.writeText(
                JSON.stringify(makeInvite(contact, store.config!.accountAddress), null, 2)
              );
              setInviteCopied(true);
              setTimeout(() => setInviteCopied(false), 1500);
            }}
          >
            {inviteCopied ? "invite copied ✓" : "copy invite"}
          </button>
        )}
        <span className="head-note">
          {pool
            ? contact.inKey
              ? "messages are permanent · you pay publicly, who and how much stay private"
              : "their channel to you isn’t discovered yet — replies appear after they write or pay you"
            : walletMode
              ? "messages are permanent · each message carries a 1 wei note to yourself, signed and proved by your wallet"
              : "messages are permanent · encrypted end to end"}
        </span>
      </div>

      <div className="bubbles">
        {thread.length === 0 && (
          <p className="hint center">
            {pool ? (
              <>
                Pool mode: pairing happens through the pool itself. Your first message or payment
                opens the channel; {contact.label} discovers it on their side. Their lane to you
                appears once they write or pay you back.
              </>
            ) : contact.derived ? (
              <>
                Address-paired thread: {contact.label} connects by adding <em>your</em> address{" "}
                <code>{shorten(store.identity)}</code> — no invite needed. (Address-paired lanes
                are less confidential than invites; anyone who guesses the pair can derive them.)
              </>
            ) : (
              <>No messages yet. Write one below — it queues into the outbox.</>
            )}
          </p>
        )}
        {thread.map((m) => {
          const key = `${m.channelKey}:${m.index}`;
          const receipt = receipts.get(key);
          return (
            <div key={key} className={`bubble ${m.direction}${m.payment || m.request ? " value" : ""}`}>
              {m.payment && (
                <div className="bubble-payment" title={m.payment.token}>
                  {m.direction === "sent" ? "💸 you paid" : "💸 you received"} {describeAmount(m.payment.amount, m.payment.token)}
                </div>
              )}
              {m.request && (
                <div className="bubble-payment" title={m.request.token}>
                  {m.direction === "sent" ? "🧾 you requested" : `🧾 ${contact.label} requests`}{" "}
                  {describeAmount(m.request.amount, m.request.token)}
                </div>
              )}
              {m.body && <div className="bubble-body">{m.body}</div>}
              {m.request && (
                <div className="bubble-actions">
                  {m.request.settledBy !== undefined ? (
                    <span className="settled">✓ paid</span>
                  ) : m.direction === "received" && canPay ? (
                    <button className="primary small" disabled={busy} onClick={() => payRequest(m)}>
                      Pay {describeAmount(m.request.amount, m.request.token)}
                    </button>
                  ) : m.direction === "received" ? (
                    <span className="hint">paying needs pool mode</span>
                  ) : (
                    <span className="hint">waiting for {contact.label} to pay</span>
                  )}
                </div>
              )}
              {m.payment && m.direction === "received" && canPay && receipts.has(key) && (
                <div className={`receipt ${receipt === true ? "ok" : receipt === false ? "pending" : ""}`}>
                  {receipt === true
                    ? "✓ receipt: an unspent note of this amount is in your pool balance"
                    : receipt === false
                      ? "receipt: no matching unspent note yet (still indexing, or already spent)"
                      : "checking your notes in the pool…"}
                </div>
              )}
              <div className="bubble-meta">
                {new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="compose">
        <textarea
          rows={2}
          placeholder={
            panel === "pay"
              ? `Memo for the payment (private, rides in the same transaction)…`
              : panel === "request"
                ? `What is it for? (goes with the request)…`
                : `Message ${contact.label}… (adds to the outbox, not sent immediately)`
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && panel === null) {
              e.preventDefault();
              queueDraft();
            }
          }}
        />
        <div className="compose-foot">
          <span className="tier">
            {preview.tier
              ? `${preview.tier} B tier · ${fmtUsd(preview.usd ?? 0)}`
              : `too long by ${preview.overBy} bytes — split it or attach a link`}
          </span>
          {preview.boundary && (
            <span className="tier-warning">
              {preview.boundary.bytesLeft} more bytes moves this to the{" "}
              {preview.boundary.nextTier >= 1024
                ? `${preview.boundary.nextTier / 1024} KiB`
                : `${preview.boundary.nextTier} B`}{" "}
              tier (+{fmtUsd(preview.boundary.extraUsd)})
            </span>
          )}
          {canPay && (
            <>
              <button className={panel === "pay" ? "primary" : ""} onClick={() => openPanel("pay")} disabled={busy}>
                {panel === "pay" ? "cancel" : "💸 send STRK"}
              </button>
              <button className={panel === "request" ? "primary" : ""} onClick={() => openPanel("request")} disabled={busy}>
                {panel === "request" ? "cancel" : "🧾 request"}
              </button>
            </>
          )}
          <button className="primary" disabled={!draft.trim() || !preview.tier || panel !== null} onClick={queueDraft}>
            Add to outbox
          </button>
        </div>

        {canPay && panel && (
          <div className="pay-panel">
            <span className="row" style={{ flex: 1, minWidth: 220 }}>
              <input className="mono" placeholder="token 0x…" value={payToken} onChange={(e) => setPayToken(e.target.value)} />
              {isStrk(payToken) ? (
                <span className="hint">STRK</span>
              ) : (
                <button className="ghost" title="Use STRK" onClick={() => setPayToken(STRK_TOKEN)}>
                  STRK
                </button>
              )}
            </span>
            <input
              className="mono"
              placeholder={amountLabel}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value.replace(decimals > 0 ? /[^0-9.]/g : /[^0-9]/g, ""))}
            />
            {amountUnits !== null && (
              <span className="hint" style={{ flexBasis: "auto" }}>
                = {describeAmount(amountUnits, payToken)}
              </span>
            )}

            {panel === "pay" && (
              <>
                <span className={typeof inPool === "bigint" && inPool === 0n ? "probe-err" : "hint"} style={{ flexBasis: "100%" }}>
                  {inPool === "checking"
                    ? "reading your notes in the pool…"
                    : typeof inPool === "bigint"
                      ? `in pool: ${describeAmount(inPool, payToken)} spendable${
                          maturing
                            ? ` (+${describeAmount(maturing.amount, payToken)} maturing — ~${maturing.blocks} more block${maturing.blocks === 1 ? "" : "s"}, ~${maturing.blocks * 30} s)`
                            : ""
                        }${pool ? ` · wallet: ${store.strkBalance ?? "?"} STRK` : ""} — a payment spends notes INSIDE the pool, not the wallet${
                          inPool === 0n && !maturing
                            ? pool
                              ? ". You hold none: use Shield below (on Sepolia it needs the operator's screening prover — Settings)."
                              : "."
                            : "."
                        }`
                      : ""}
                </span>
                {(pool || walletMode) && (
                  <span className="row" style={{ flexBasis: "100%" }}>
                    <input
                      className="mono"
                      placeholder="shield: amount in STRK (public → private)"
                      value={shieldAmount}
                      onChange={(e) => setShieldAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                      style={{ maxWidth: 260 }}
                    />
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
                    <span className="hint">
                      {walletMode
                        ? "the wallet builds, screens and signs the deposit — approve it in the wallet"
                        : "deposits are screened by the pool — on Sepolia this needs the operator's prover (Settings)"}
                    </span>
                  </span>
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !/^0x[0-9a-fA-F]+$/.test(payToken) ||
                    amountUnits === null ||
                    (typeof inPool === "bigint" && amountUnits > inPool)
                  }
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
                      void store
                        .simulatePayment(contact, payToken.trim(), amountUnits!, draft)
                        .then(setSimulation, (e: unknown) => setSimulation([{ method: "simulate", ok: false, detail: e instanceof Error ? e.message : String(e) }]));
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
                <span className="hint">
                  One transaction: the transfer and the memo confirm together or not at all. You are
                  the public submitter; {contact.label} and the amount are not in the envelope.
                </span>
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
                <span className="hint">
                  A request is a message: it costs you no pool balance and sends with the next batch.
                  {contact.label} sees a “Pay” button; their payment settles it here as “✓ paid”.
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
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
