import { ArrowLeft, CheckCircle, PaperPlaneTilt, ShareNetwork } from "@phosphor-icons/react";
import { useState } from "react";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { makeGroupInvite, stitchGroupThread, type Group } from "../lib/groups.js";
import { store } from "../lib/store.js";

import { PrivacyLockTip } from "./privacy.js";

export function GroupView({
  group,
  onBack,
}: {
  group: Group;
  onBack?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const me = store.identity;
  const history = store.engine?.history() ?? [];
  const thread = stitchGroupThread(history, group, me);
  const preview = tierPreview(draft);

  const queueDraft = () => {
    if (!draft.trim() || !preview.tier) return;
    store.queueToGroup(group, draft);
    setDraft("");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-baseline gap-2.5 border-b border-border bg-card px-4 py-3">
        {onBack && (
          <button
            type="button"
            className="mr-1 inline-flex items-center rounded-lg p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground md:hidden"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft size={18} weight="regular" aria-hidden="true" />
          </button>
        )}
        <strong>#{group.name}</strong>
        <span className="text-sm text-muted-foreground">{group.members.length} members</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
          title="Copy the group invite — new members paste it under '+ group'. Note: joining reveals the group's FULL history."
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(makeGroupInvite(group), null, 2));
            setInviteCopied(true);
            setTimeout(() => setInviteCopied(false), 1500);
          }}
        >
          {inviteCopied ? (
            <>
              <CheckCircle size={14} weight="regular" aria-hidden="true" />
              invite copied
            </>
          ) : (
            <>
              <ShareNetwork size={14} weight="regular" aria-hidden="true" />
              copy group invite
            </>
          )}
        </button>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          messages are permanent · one lane per member
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {thread.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            No messages yet. Every member writes on their own encrypted lane; everyone reads all
            lanes.
          </p>
        )}
        {thread.map((m) => (
          <div
            key={`${m.channelKey}:${m.index}`}
            className={`max-w-[62%] rounded-2xl border px-3.5 py-2.5 ${
              m.direction === "sent"
                ? "self-end rounded-br-sm border-border-strong bg-sent text-sent-ink"
                : "self-start rounded-bl-sm border-border bg-received text-foreground"
            }`}
          >
            {m.direction === "received" && (
              <div className="mb-0.5 text-[11.5px] font-semibold text-primary">{m.senderLabel}</div>
            )}
            <div>{m.body}</div>
            <div className="mt-0.5 text-right text-[11px] opacity-70">
              {new Date(m.timestamp * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ))}
      </div>

      <form
        className="border-t border-border bg-card px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          queueDraft();
        }}
      >
        <div className="mb-2">
          <PrivacyLockTip />
        </div>
        <textarea
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-primary"
          rows={2}
          placeholder={`Message #${group.name}… (queues to outbox — composer stays open during proving)`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              queueDraft();
            }
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {preview.tier
              ? `${preview.tier} B tier · ${fmtUsd(preview.usd ?? 0)}`
              : `too long by ${preview.overBy} bytes — split it or attach a link`}
          </span>
          <button
            type="submit"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 font-semibold text-on-primary transition-opacity duration-200 hover:opacity-90 disabled:opacity-45"
            disabled={!draft.trim() || !preview.tier}
          >
            <PaperPlaneTilt size={16} weight="regular" aria-hidden="true" />
            Add to outbox
          </button>
        </div>
      </form>
    </div>
  );
}
