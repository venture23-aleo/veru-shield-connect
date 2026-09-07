import { useState } from "react";
import { parseInvite } from "../lib/contacts.js";
import { parseGroupInvite } from "../lib/groups.js";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

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
  const [discovering, setDiscovering] = useState<string | null>(null);
  const pool = store.isPool;
  // Pool mode: pairing IS the pool — invites are a dev-mode affordance.
  const invite = !pool && inviteText.trim() ? parseInvite(inviteText) : null;

  const discover = async () => {
    setDiscovering("discovering…");
    try {
      const { updated, added } = await store.discoverLanes();
      await store.syncNow();
      setDiscovering(added + updated === 0 ? "nothing new" : `${added} new · ${updated} updated`);
    } catch (e) {
      setDiscovering(e instanceof Error ? e.message : String(e));
    }
    setTimeout(() => setDiscovering(null), 2500);
  };

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
        ? // Invite: carries the mirrored lane keys (confidential pairing).
          await store.addContact(label.trim(), invite.peer, {
            outKey: invite.yourOutKey,
            inKey: invite.yourInKey,
          })
        : // Address only: lanes derive from the two addresses (dev pairing).
          await store.addContact(label.trim(), peer.trim());
      reset();
      onSelect(contact.label);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Contacts</span>
        <span className="row" style={{ gap: 2 }}>
          {pool && (
            <button className="ghost" title="Pull channel keys from the pool's scan" onClick={() => void discover()}>
              ↻ discover
            </button>
          )}
          <button className="ghost" onClick={() => (adding ? reset() : setAdding(true))}>
            {adding ? "cancel" : "+ add"}
          </button>
        </span>
      </div>
      {discovering && (
        <p className="hint" style={{ padding: "0 14px" }}>
          {discovering}
        </p>
      )}
      {adding && (
        <div className="add-contact">
          <input placeholder="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
          {!invite && (
            <input
              placeholder="Starknet address (0x…)"
              value={peer}
              onChange={(e) => setPeer(e.target.value)}
            />
          )}
          {!pool && (
            <textarea
              rows={3}
              placeholder="…or paste an invite from the other person (thread head → copy invite)"
              value={inviteText}
              onChange={(e) => setInviteText(e.target.value)}
            />
          )}
          {!pool && inviteText.trim() !== "" && (
            <p className={invite ? "hint invite-ok" : "error"}>
              {invite
                ? `✓ invite from ${shorten(invite.peer)} — lanes will pair with their thread`
                : "that doesn't look like an invite"}
            </p>
          )}
          {addError && <p className="error">{addError}</p>}
          <button className="primary" disabled={!label.trim() || (!invite && !peer.trim())} onClick={() => void add()}>
            {invite ? "Add paired contact" : "Add contact"}
          </button>
          <p className="hint">
            {pool ? (
              <>
                Pool mode pairs through the pool: they must be registered (<code>SetViewingKey</code>)
                for you to write to them, and their replies appear once discovery finds their
                channel to you.
              </>
            ) : (
              <>
                Adding by address pairs automatically — the other person just adds <em>your</em>{" "}
                address back. Prefer an invite when the pairing itself should stay confidential.
              </>
            )}
          </p>
        </div>
      )}
      <ul className="contact-list">
        {store.contacts.map((c) => (
          <li key={c.label}>
            <button
              className={`contact ${c.label === active ? "active" : ""}`}
              onClick={() => onSelect(c.label)}
            >
              <span className="contact-name">{c.label}</span>
              <span className="contact-addr">{shorten(c.peer)}</span>
              {!c.registered && <span className="badge warn">unregistered</span>}
              {pool && c.registered && !c.inKey && <span className="badge info">no inbound lane yet</span>}
            </button>
          </li>
        ))}
      </ul>
      <GroupsSection active={active} onSelect={onSelect} />
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
      <div className="sidebar-head">
        <span>Groups</span>
        <button className="ghost" onClick={() => (adding ? reset() : setAdding(true))}>
          {adding ? "cancel" : "+ group"}
        </button>
      </div>
      {adding && (
        <div className="add-contact">
          {!invite && (
            <>
              <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
              <textarea
                rows={3}
                placeholder="Member addresses, one per line (you are included automatically)"
                value={membersText}
                onChange={(e) => setMembersText(e.target.value)}
              />
            </>
          )}
          <textarea
            rows={3}
            placeholder="…or paste a group invite (joining reveals the group's full history)"
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
          />
          {inviteText.trim() !== "" && (
            <p className={invite ? "hint invite-ok" : "error"}>
              {invite
                ? `✓ invite to #${invite.name} · ${invite.members.length} members`
                : "that doesn't look like a group invite"}
            </p>
          )}
          <button
            className="primary"
            disabled={!invite && !name.trim()}
            onClick={create}
          >
            {invite ? `Join #${invite.name}` : "Create group"}
          </button>
        </div>
      )}
      <ul className="contact-list">
        {store.groups.map((g) => (
          <li key={g.name}>
            <button
              className={`contact ${`#${g.name}` === active ? "active" : ""}`}
              onClick={() => onSelect(`#${g.name}`)}
            >
              <span className="contact-name">#{g.name}</span>
              <span className="contact-addr">{g.members.length} members</span>
            </button>
          </li>
        ))}
        {store.groups.length === 0 && !adding && (
          <li className="hint" style={{ padding: "4px 14px 10px" }}>
            (no groups)
          </li>
        )}
      </ul>
    </>
  );
}
