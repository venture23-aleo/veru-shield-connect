import { ArrowLeft, CheckCircle, CurrencyDollar, PaperPlaneTilt, ShareNetwork } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { decimalsOf, describeAmount, isStrk, parseAmount, STRK_TOKEN } from "../lib/amounts.js";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { makeGroupInvite, stitchGroupThread, type Group, type GroupMember } from "../lib/groups.js";
import { store } from "../lib/store.js";
import { PrivacyLockTip } from "./privacy.js";

export function GroupView({ group, onBack }: { group: Group; onBack?: () => void }) {
  const [draft, setDraft] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [payToken, setPayToken] = useState(store.config?.carrierToken || STRK_TOKEN);
  const [amountEach, setAmountEach] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [inPool, setInPool] = useState<bigint | null>(null);
  const me = store.identity;
  const canPay = store.canPay;
  const busy = store.flush.phase === "proving" || store.flush.phase === "submitted" || store.flush.phase === "encrypting";
  const history = store.engine?.history() ?? [];
  const thread = stitchGroupThread(history, group, me);
  const pending = store.pendingFor(`#${group.name}`);
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
  const sendNow = () => {
    if (draft.trim() && preview.tier) {
      store.queueToGroup(group, draft);
      setDraft("");
    }
    if (store.queuedTiers().length > 0 && !busy) void store.sendBatch();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-16 items-center gap-3 bg-surface-lowest/80 px-4 backdrop-blur-md lg:px-6">
        {onBack && (
          <button type="button" className="inline-flex items-center rounded-lg p-1.5 text-muted-foreground hover:bg-surface-mid hover:text-foreground md:hidden" onClick={onBack} aria-label="Back to conversations">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        )}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-high font-mono text-xs font-bold text-primary">#</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-lg font-semibold text-foreground">#{group.name}</span>
            <span className="mono-sm rounded bg-surface-high px-1.5 py-0.5 text-secondary">{group.members.length} members</span>
          </div>
          <div className="mt-0.5 mono-sm text-muted-foreground">one encrypted lane per member · everyone reads all lanes · permanent</div>
        </div>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-surface-mid hover:text-foreground"
          title="Copy the group invite — new members paste it under 'group'. Joining reveals the group's FULL history."
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(makeGroupInvite(group), null, 2));
            setInviteCopied(true);
            setTimeout(() => setInviteCopied(false), 1500);
          }}
        >
          {inviteCopied ? <CheckCircle size={14} aria-hidden="true" /> : <ShareNetwork size={14} aria-hidden="true" />}
          {inviteCopied ? "invite copied" : "copy group invite"}
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 lg:px-6">
        {thread.length === 0 && pending.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">No messages yet. Every member writes on their own encrypted lane; everyone reads all lanes.</p>
        )}
        {thread.map((m) => (
          <div key={`${m.channelKey}:${m.index}`} className={`flex max-w-2xl flex-col gap-1 ${m.direction === "sent" ? "ml-auto items-end" : "items-start"}`}>
            <div className="flex items-center gap-1.5">
              <span className={`mono-sm font-medium ${m.direction === "sent" ? "text-primary" : "text-secondary"}`}>{m.direction === "sent" ? "you" : m.senderLabel}</span>
              <span className="text-xs text-outline">{new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className={`rounded-2xl p-4 shadow-sm ${m.direction === "sent" ? "rounded-tr-sm bg-surface-mid" : "rounded-tl-sm bg-surface-low"} ${m.payment ? "border border-primary/25" : ""}`}>
              {m.payment && (
                <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-primary" title={m.payment.token}>
                  <CurrencyDollar size={14} aria-hidden="true" />
                  {m.direction === "sent" ? "you" : m.senderLabel} paid {describeAmount(m.payment.amount, m.payment.token)} each
                </div>
              )}
              <p className="text-sm leading-relaxed text-foreground">{m.body}</p>
            </div>
          </div>
        ))}
        {pending.map((e) => (
          <div key={e.id} className="ml-auto flex max-w-2xl flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-outline">{new Date(e.queuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="mono-sm font-medium text-primary">{e.status === "queued" ? "queued" : e.status}</span>
            </div>
            <div className={`rounded-2xl rounded-tr-sm p-4 ${e.status === "queued" ? "bg-surface-low text-muted-foreground" : "bg-surface-mid text-foreground"}`}>
              <p className="text-sm leading-relaxed">{e.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="legacy flex flex-col gap-2.5 bg-surface-lowest p-4">
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5 mono-sm text-muted-foreground">
          <PrivacyLockTip />
          <span className="text-outline">{preview.tier ? `${preview.tier} B tier · ${fmtUsd(preview.usd ?? 0)}` : draft ? `too long by ${preview.overBy} bytes` : ""}</span>
        </div>
        {canPay && others.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button type="button" className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 mono-sm transition-colors ${splitOpen ? "bg-primary/15 font-medium text-primary" : "bg-surface-mid text-muted-foreground hover:text-foreground"}`} style={{ border: 0 }} disabled={busy} onClick={() => setSplitOpen(!splitOpen)} aria-pressed={splitOpen}>
              <CurrencyDollar size={12} aria-hidden="true" />
              {splitOpen ? "cancel split" : "split / tip"}
            </button>
          </div>
        )}
        <form
          className="flex items-end gap-2.5 rounded-xl bg-surface-low p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!splitOpen) sendNow();
          }}
        >
          <textarea
            className="flex-1 resize-none bg-transparent px-0.5 text-sm text-foreground outline-none placeholder:text-outline"
            style={{ border: 0, background: "transparent" }}
            rows={2}
            placeholder={splitOpen ? "Memo for the group (why you are paying)…" : `Message #${group.name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !splitOpen) {
                e.preventDefault();
                sendNow();
              }
            }}
          />
          {!splitOpen && (
            <>
              <button type="button" className="ghost" title="Queue only — send several messages as one transaction later" disabled={!draft.trim() || !preview.tier} onClick={queueDraft}>
                queue
              </button>
              <button type="submit" className="primary" disabled={(!draft.trim() || !preview.tier) && store.queuedTiers().length === 0 || busy}>
                <span className="inline-flex items-center gap-1.5">
                  <PaperPlaneTilt size={16} aria-hidden="true" />
                  Send
                </span>
              </button>
            </>
          )}
        </form>

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
              <button className="ghost small" onClick={() => setChosen(new Set(others.map((m) => m.address.toLowerCase())))}>
                everyone
              </button>
            </div>
            <span className="row" style={{ flex: 1, minWidth: 220 }}>
              <input className="mono" placeholder="token 0x…" value={payToken} onChange={(e) => setPayToken(e.target.value)} />
              {isStrk(payToken) ? <span className="hint" style={{ flexBasis: "auto" }}>STRK</span> : <button className="ghost small" title="Use STRK" onClick={() => setPayToken(STRK_TOKEN)}>STRK</button>}
            </span>
            <input className="mono" placeholder={decimals > 0 ? "amount EACH in STRK, e.g. 2.5" : "amount EACH (smallest unit)"} value={amountEach} onChange={(e) => setAmountEach(e.target.value.replace(decimals > 0 ? /[^0-9.]/g : /[^0-9]/g, ""))} />
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
            <span className="hint">One transaction, one proof, one fee: a private note to each chosen member plus a memo on your group lane. The group sees who was paid what; the chain sees only that you submitted.</span>
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
