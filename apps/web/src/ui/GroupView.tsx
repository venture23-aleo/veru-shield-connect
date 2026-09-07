import { useEffect, useState } from "react";
import { decimalsOf, describeAmount, isStrk, parseAmount, STRK_TOKEN } from "../lib/amounts.js";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { makeGroupInvite, stitchGroupThread, type Group, type GroupMember } from "../lib/groups.js";
import { store } from "../lib/store.js";

export function GroupView({ group }: { group: Group }) {
  const [draft, setDraft] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [payToken, setPayToken] = useState(store.config?.carrierToken || STRK_TOKEN);
  const [amountEach, setAmountEach] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [inPool, setInPool] = useState<bigint | null>(null);
  const me = store.identity;
  const canPay = store.canPay;
  const busy = store.flush.phase === "proving" || store.flush.phase === "submitted";
  const history = store.engine?.history() ?? [];
  const thread = stitchGroupThread(history, group, me);
  const preview = tierPreview(draft);
  const others = group.members.filter((m) => !sameAddr(m.address, me));
  const decimals = decimalsOf(payToken);
  const each = parseAmount(amountEach, decimals);
  const recipients: GroupMember[] = others.filter((m) => chosen.has(m.address.toLowerCase()));
  const total = each !== null ? each * BigInt(recipients.length) : null;
  const lastTx = store.flush.phase === "confirmed" ? store.flush.txHash : undefined;

  useEffect(() => {
    if (!splitOpen || !canPay) return;
    setChosen((c) => (c.size === 0 ? new Set(others.map((m) => m.address.toLowerCase())) : c));
    let cancelled = false;
    store.backend!.pool!.poolNotes(payToken.trim()).then(
      (r) => !cancelled && setInPool(r.spendable),
      () => !cancelled && setInPool(null)
    );
    return () => {
      cancelled = true;
    };
  }, [splitOpen, canPay, payToken, lastTx]); // eslint-disable-line react-hooks/exhaustive-deps

  const queueDraft = () => {
    if (!draft.trim() || !preview.tier) return;
    store.queueToGroup(group, draft);
    setDraft("");
  };

  return (
    <div className="thread">
      <div className="thread-head">
        <strong>#{group.name}</strong>
        <span className="hint">{group.members.length} members</span>
        <button
          className="ghost"
          title="Copy the group invite — new members paste it under '+ group'. Note: joining reveals the group's FULL history."
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(makeGroupInvite(group), null, 2));
            setInviteCopied(true);
            setTimeout(() => setInviteCopied(false), 1500);
          }}
        >
          {inviteCopied ? "invite copied ✓" : "copy group invite"}
        </button>
        <span className="head-note">messages are permanent · one lane per member</span>
      </div>

      <div className="bubbles">
        {thread.length === 0 && (
          <p className="hint center">
            No messages yet. Every member writes on their own encrypted lane; everyone reads all lanes.
          </p>
        )}
        {thread.map((m) => (
          <div key={`${m.channelKey}:${m.index}`} className={`bubble ${m.direction}${m.payment ? " value" : ""}`}>
            {m.direction === "received" && <div className="bubble-sender">{m.senderLabel}</div>}
            {m.payment && (
              <div className="bubble-payment" title={m.payment.token}>
                💸 {m.direction === "sent" ? "you" : m.senderLabel} paid {describeAmount(m.payment.amount, m.payment.token)} each
              </div>
            )}
            <div className="bubble-body">{m.body}</div>
            <div className="bubble-meta">
              {new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </div>

      <div className="compose">
        <textarea
          rows={2}
          placeholder={splitOpen ? "Memo for the group (why you are paying)…" : `Message #${group.name}… (adds to the outbox, not sent immediately)`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !splitOpen) {
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
          {canPay && others.length > 0 && (
            <button className={splitOpen ? "primary" : ""} disabled={busy} onClick={() => setSplitOpen(!splitOpen)}>
              {splitOpen ? "cancel" : "💸 split / tip"}
            </button>
          )}
          <button className="primary" disabled={!draft.trim() || !preview.tier || splitOpen} onClick={queueDraft}>
            Add to outbox
          </button>
        </div>

        {canPay && splitOpen && (
          <div className="pay-panel">
            <div className="members" style={{ flexBasis: "100%" }}>
              {others.map((m) => {
                const k = m.address.toLowerCase();
                return (
                  <label key={k} className="member-pick">
                    <input
                      type="checkbox"
                      checked={chosen.has(k)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(k);
                        else next.delete(k);
                        setChosen(next);
                      }}
                    />
                    {m.label ?? `${m.address.slice(0, 6)}…${m.address.slice(-4)}`}
                  </label>
                );
              })}
              <button className="ghost" onClick={() => setChosen(new Set(others.map((m) => m.address.toLowerCase())))}>
                everyone
              </button>
            </div>
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
              placeholder={decimals > 0 ? "amount EACH in STRK, e.g. 2.5" : "amount EACH (smallest unit)"}
              value={amountEach}
              onChange={(e) => setAmountEach(e.target.value.replace(decimals > 0 ? /[^0-9.]/g : /[^0-9]/g, ""))}
            />
            <span className={inPool !== null && total !== null && total > inPool ? "probe-err" : "hint"} style={{ flexBasis: "100%" }}>
              {total !== null ? `total ${describeAmount(total, payToken)} to ${recipients.length} member${recipients.length === 1 ? "" : "s"}` : "pick members and an amount each"}
              {inPool !== null ? ` · in pool: ${describeAmount(inPool, payToken)} spendable` : ""}
            </span>
            <button
              className="primary"
              disabled={busy || each === null || recipients.length === 0 || !/^0x[0-9a-fA-F]+$/.test(payToken) || (inPool !== null && total! > inPool)}
              onClick={() => {
                const memo = draft;
                setDraft("");
                setSplitOpen(false);
                setAmountEach("");
                void store.payGroup(group, payToken.trim(), each!, recipients, memo);
              }}
            >
              {recipients.length === 1 ? "Tip" : "Split"}: pay {recipients.length} member{recipients.length === 1 ? "" : "s"} & post memo
            </button>
            <span className="hint">
              One transaction, one proof, one fee: a private note to each chosen member plus a memo on your group lane.
              The group sees who was paid what; the chain sees only that you submitted.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function sameAddr(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}
