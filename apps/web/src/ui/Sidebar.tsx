import { MagnifyingGlass, Plus, Users, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { parseInvite, stitchThread } from "../lib/contacts.js";
import { parseGroupInvite } from "../lib/groups.js";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";
import { relativeTime } from "./privacy.js";

function monogram(label: string): string {
  const parts = label.replace(/^#/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export function Sidebar({
  active,
  onSelect,
}: {
  active: string | null;
  onSelect: (label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [peer, setPeer] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const invite = inviteText.trim() ? parseInvite(inviteText) : null;
  const history = store.engine?.history() ?? [];
  const status = store.engine?.status();
  const peerCount = store.contacts.length + store.groups.length;

  const reset = () => {
    setAdding(false);
    setLabel("");
    setPeer("");
    setInviteText("");
    setAddError(null);
  };

  const add = async () => {
    if (!label.trim()) return;
    try {
      if (!invite) {
        const p = peer.trim();
        if (!/^0x[0-9a-fA-F]+$/.test(p)) throw new Error("that's not a Starknet address (0x…)");
        if (BigInt(p) === BigInt(store.identity)) {
          throw new Error("that's your own address — add the other person's");
        }
      }
      const contact = invite
        ? await store.addContact(label.trim(), invite.peer, {
            outKey: invite.yourOutKey,
            inKey: invite.yourInKey,
          })
        : await store.addContact(label.trim(), peer.trim());
      reset();
      onSelect(contact.label);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.contacts;
    return store.contacts.filter(
      (c) => c.label.toLowerCase().includes(q) || c.peer.toLowerCase().includes(q)
    );
  }, [query, store.contacts]);

  return (
    <aside className="flex h-full w-full flex-col bg-surface-low md:w-channels md:shrink-0 md:border-r md:border-border">
      <div className="bg-surface-lowest p-2">
        <div className="relative flex items-center">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-2.5 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            className="w-full rounded-lg bg-surface-high py-2 pr-2.5 pl-9 text-xs text-foreground outline-none placeholder:text-outline focus:bg-surface-highest"
            placeholder="Search nicknames or commitments…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-0.5 bg-surface-high/60 px-2.5 py-1.5">
        <div className="flex items-center justify-between mono-sm">
          <div className="flex items-center gap-1.5 text-secondary">
            <span
              className={`h-1.5 w-1.5 rounded-full ${store.syncing ? "animate-pulse bg-secondary" : "bg-primary"}`}
            />
            <span>{store.syncing ? "Checking new messages…" : "Local scan idle"}</span>
          </div>
          <span className="font-medium text-foreground">
            Scan: {store.syncing ? "72%" : status?.syncedToBlock != null ? "100%" : "—"}
          </span>
        </div>
        {store.syncing && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-highest">
            <div className="h-full w-[72%] rounded-full bg-secondary transition-all" />
          </div>
        )}
        <div className="flex items-center justify-between mono-sm text-muted-foreground">
          <span>
            {status?.syncedToBlock != null
              ? `Block #${status.syncedToBlock.toLocaleString()}`
              : "Block —"}
          </span>
          <span className="text-[10px] text-outline" title="Zero telemetry transmitted">
            Purely local; no query logs
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <span className="label-caps text-outline">Confidential Channels</span>
        <div className="flex items-center gap-2">
          <span className="mono-sm font-medium text-primary">{peerCount} Peers</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground hover:bg-surface-mid hover:text-foreground"
            onClick={() => (adding ? reset() : setAdding(true))}
          >
            {adding ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {adding ? "cancel" : "add"}
          </button>
        </div>
      </div>

      {adding && (
        <form
          className="flex flex-col gap-2 border-b border-border px-3 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            className="w-full rounded-lg border border-border bg-surface-lowest px-2.5 py-2 text-sm text-foreground placeholder:text-outline focus:border-primary"
            placeholder="Nickname (local only — never an address)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {!invite && (
            <input
              className="w-full rounded-lg border border-border bg-surface-lowest px-2.5 py-2 font-mono text-sm text-foreground placeholder:text-outline focus:border-primary"
              placeholder="Their address (0x…) — for verification only"
              value={peer}
              onChange={(e) => setPeer(e.target.value)}
            />
          )}
          <textarea
            className="w-full rounded-lg border border-border bg-surface-lowest px-2.5 py-2 text-sm text-foreground placeholder:text-outline focus:border-primary"
            rows={3}
            placeholder="…or paste an invite from the other person"
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
          />
          {inviteText.trim() !== "" && (
            <p className={`text-sm ${invite ? "text-ok" : "text-destructive"}`}>
              {invite
                ? `invite from ${shorten(invite.peer)} — lanes will pair`
                : "that doesn't look like an invite"}
            </p>
          )}
          {addError && <p className="text-sm text-destructive">{addError}</p>}
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-45"
            disabled={!label.trim() || (!invite && !peer.trim())}
          >
            {invite ? "Add paired contact" : "Add contact"}
          </button>
        </form>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        {store.contacts.length === 0 && !adding && (
          <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">
            No channels yet. Discovery is a local scan — nothing is stored elsewhere.
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {filteredContacts.map((c) => {
            const thread = stitchThread(history, c);
            const last = thread[thread.length - 1];
            const pending = store.pendingFor(c.label);
            const lastPending = pending[pending.length - 1];
            const flush = store.flush;
            const provingHere =
              lastPending &&
              (lastPending.status === "proving" ||
                (flush.phase === "proving" && pending.some((p) => p.status === "proving")));
            const preview = provingHere
              ? "Proving commitment in flight..."
              : lastPending
                ? lastPending.status === "queued"
                  ? "Queued — waiting for batch"
                  : lastPending.body
                : last?.body;
            const when = lastPending
              ? relativeTime(Math.floor(lastPending.queuedAt / 1000))
              : last
                ? relativeTime(last.timestamp)
                : null;
            const isActive = c.label === active;
            return (
              <button
                key={c.label}
                type="button"
                className={`group relative flex items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-surface-high text-foreground"
                    : "text-muted-foreground hover:bg-surface-mid hover:text-foreground"
                }`}
                onClick={() => onSelect(c.label)}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold ${
                    isActive
                      ? "bg-surface-highest text-foreground"
                      : "bg-surface-mid text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  {monogram(c.label)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-sm ${isActive ? "font-semibold text-foreground" : "font-medium text-foreground"}`}
                    >
                      {c.label}
                    </span>
                    {when && <span className="mono-sm shrink-0 text-outline">{when}</span>}
                  </div>
                  <p
                    className={`mt-0.5 truncate mono-sm ${
                      provingHere ? "flex items-center gap-1 text-primary" : "text-outline"
                    }`}
                  >
                    {provingHere && (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    )}
                    {preview ?? (c.registered ? "No messages yet" : "Unregistered")}
                  </p>
                </div>
                {provingHere && (
                  <div className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-primary shadow-sm" />
                )}
              </button>
            );
          })}
        </div>

        <GroupsSection active={active} onSelect={onSelect} />
      </div>

      <div className="m-2 flex flex-col gap-1.5 rounded-xl bg-surface-lowest p-2.5">
        <div className="flex items-center justify-between">
          <span className="label-caps text-outline">WASM Core Engine</span>
          <span className="mono-sm font-medium text-primary">Ready</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <div className="rounded bg-surface-low p-1.5">
            <span className="label-caps block text-muted-foreground">Memory Limit</span>
            <span className="mono-sm font-medium text-foreground">2048 MB Max</span>
          </div>
          <div className="rounded bg-surface-low p-1.5">
            <span className="label-caps block text-muted-foreground">Worker Cores</span>
            <span className="mono-sm font-medium text-secondary">4 Threads</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function GroupsSection({
  active,
  onSelect,
}: {
  active: string | null;
  onSelect: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [membersText, setMembersText] = useState("");
  const [inviteText, setInviteText] = useState("");
  const invite = inviteText.trim() ? parseGroupInvite(inviteText) : null;

  const reset = () => {
    setAdding(false);
    setName("");
    setMembersText("");
    setInviteText("");
  };

  const create = () => {
    if (invite) {
      const g = store.joinGroup(invite);
      reset();
      onSelect(`#${g.name}`);
      return;
    }
    if (!name.trim()) return;
    const members = membersText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => /^0x[0-9a-fA-F]+$/.test(s))
      .map((address) => ({ address }));
    const g = store.createGroup(name.trim().replace(/^#/, ""), members);
    reset();
    onSelect(`#${g.name}`);
  };

  return (
    <>
      <div className="mt-2 flex items-center justify-between border-t border-border px-3 pt-3 pb-1.5">
        <span className="label-caps inline-flex items-center gap-1.5 text-outline">
          <Users size={12} aria-hidden="true" />
          Groups
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground hover:bg-surface-mid hover:text-foreground"
          onClick={() => (adding ? reset() : setAdding(true))}
        >
          {adding ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {adding ? "cancel" : "group"}
        </button>
      </div>
      {adding && (
        <form
          className="flex flex-col gap-2 px-3 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          {!invite && (
            <>
              <input
                className="w-full rounded-lg border border-border bg-surface-lowest px-2.5 py-2 text-sm"
                placeholder="Group name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <textarea
                className="w-full rounded-lg border border-border bg-surface-lowest px-2.5 py-2 text-sm"
                rows={3}
                placeholder="Member addresses, one per line"
                value={membersText}
                onChange={(e) => setMembersText(e.target.value)}
              />
            </>
          )}
          <textarea
            className="w-full rounded-lg border border-border bg-surface-lowest px-2.5 py-2 text-sm"
            rows={3}
            placeholder="…or paste a group invite"
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary disabled:opacity-45"
            disabled={!invite && !name.trim()}
          >
            {invite ? `Join #${invite.name}` : "Create group"}
          </button>
        </form>
      )}
      {store.groups.map((g) => {
        const isActive = `#${g.name}` === active;
        return (
          <button
            key={g.name}
            type="button"
            className={`flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors ${
              isActive ? "bg-surface-high" : "hover:bg-surface-mid"
            }`}
            onClick={() => onSelect(`#${g.name}`)}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-mid font-mono text-xs font-semibold">
              {monogram(g.name)}
            </div>
            <div className="min-w-0">
              <span className="font-medium text-foreground">#{g.name}</span>
              <p className="mono-sm text-outline">{g.members.length} members</p>
            </div>
          </button>
        );
      })}
    </>
  );
}
