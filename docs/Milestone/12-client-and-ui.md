# 13 — Client Architecture & UI

## The constraint that forces the architecture

Sending a message needs two capabilities, and STRK20 splits them across two integration routes:

| Capability | Wallet API route | Low-level SDK route |
| --- | --- | --- |
| Submit an anonymizer invoke | **Yes** — `account.strk20InvokeTransaction([{ type: "invoke", … }])`, explicitly without touching a viewing key | Yes |
| Access the viewing key, to derive `channel_key` and encrypt/decrypt | **No** — by design; "do not ask a normal dapp user for their viewing key" | Yes |
| Runs in a browser | **Yes** — all React guidance targets it | **Documented Node ≥ 24 only** |

So submission is not the problem. **Cryptography is.** Any client that encrypts or decrypts
messages under STRK20 channel keys needs the viewing key, and the route that grants it has no
documented browser support.

That produces two coherent architectures rather than one blocked path.

---

## Option A — Inherit STRK20's keys

Messages are filed under `channel_key`, exactly as designed in
[04-cryptography.md](04-cryptography.md).

**Consequences.** The client is wallet-class software holding viewing keys, on Node — a
desktop app with a Node sidecar (Tauri or Electron), a local daemon behind a localhost UI, a
CLI, or a messaging feature inside an existing privacy wallet. Channel establishment and
discovery come free. The escrowed auditor key reads message content
([D10](09-open-decisions.md)).

**Best when** the product is a wallet, or is shipped as a feature of one.

---

## Option B — Independent messaging keys

Derive a messaging keypair from a single wallet signature — the pattern STRK20's own Privacy
Bridge uses, where "all client-side key material is derived from a single wallet signature."
Do ECDH against a registered messaging public key, and derive message slots and body keys from
*that* secret rather than from the pool viewing key.

```
msk  = h(sign(wallet, "strk20-msg/v1"), "identity")  mod n
MPK  = msk · G
crk  = h(ECDH(msk, MPK_peer).x, "channel")
msg_id = h(MSG_ID_TAG, crk, index)
```

**Consequences.** No viewing key needed, so the whole client runs in a browser and submits via
`strk20InvokeTransaction`. **The auditor cannot read message content** — key recovery yields
metadata only, which resolves [D10](09-open-decisions.md) in the other direction. The costs:
we build channel establishment, intro discovery and the tag ratchet ourselves — roughly the
design deleted in the v0.1→v0.2 revision — and users hold a second key, though a
signature-derived one they never see.

**Best when** the product is a dapp, or when auditor-readable message content is unacceptable.

---

## Recommendation

**Option A for v1, via a CLI, and run the browser-bundling spike in parallel.**

The CLI runs on Node natively, proves the entire path end to end, and carries no UI risk while
the harder questions resolve. Option A also keeps the crypto surface minimal, which matters
most in the phase where the design is still moving.

Two experiments decide whether Option B is even necessary, and both are cheap:

1. **Bundle the Privacy SDK into a Vite app.** The stated reason for the Node floor is that
   `ohttp-ts` "needs modern WebCrypto" — but browsers have had WebCrypto for years, so this
   reads like a Node *version* floor rather than a browser exclusion. Nobody documents
   bundling it. An afternoon settles it.
2. **Ask whether a wallet-side derivation method is on the roadmap.** A
   `strk20DeriveChannelKey(peer)` or `strk20Decrypt(...)` call would make Option A work in a
   browser with no key exposure, and would be the clean long-term answer for every messaging
   integration, not just ours.

Option B should be a deliberate choice about *auditability*, not a workaround for a bundling
limitation.

---

## The interface is an outbox, not a chat window

Four constraints all point the same way, and designing against them produces a worse product
than designing for them:

- **~29 s proving** and **one invoke per transaction** → batching is the primary interaction
- **One storage slot per 31 bytes** → every send costs real money
- **WriteOnce storage** → nothing can be deleted or edited
- **Notes mature 10 blocks; `provingBlockId = head − 10`** → pending states are inherent

### Send states

Never show an optimistic sent tick. Four of these last long enough for a user to notice:

```
Draft → Queued → Proving (~29 s) → Submitted → Confirmed
```

### Make the batch a control, not a spinner

```
┌──────────────────────────────────────────────┐
│  Outbox · 3 messages queued                  │
│  ~29 s · ~$0.04 · one transaction            │
│                              [ Send batch ]  │
└──────────────────────────────────────────────┘
```

Users tolerate latency they can see coming and chose to trigger. They do not tolerate a
spinner that appears after they press enter. The batching constraint, surfaced honestly, is
better UX than the same delay hidden.

### Show cost and tier before sending

Padding buckets are visible in the price, so show them — `256 B tier`, and warn at boundaries:
*"12 more characters moves this to the 1 KiB tier, +$0.03."* Otherwise message length is an
invisible cost cliff that users discover by paying for it.

### Sync state is first-class

A stale indexer renders as "no new messages," which is the worst possible failure mode for a
messaging app. Put `synced to block 1,284,332 · 2 min ago` in the chrome, not in a settings
pane, and surface divergence if multiple sources disagree.

## Three things the UI must say out loud

At onboarding — not in settings, not in a footnote:

1. **An auditor can read these messages** under lawful process (Option A). A user who learns
   this later has been misled.
2. **Messages are permanent.** Offer no delete affordance at all; if you offer "hide," label it
   local-only and mean it.
3. **"A message was sent" is public**, even though the content and both parties are not.

## Two flows that need real design

**Unregistered recipient.** You cannot send to someone who has not run `SetViewingKey`. That is
a hard failure at compose time, and STRK20's escrow helper solves the payments version with an
off-band claim link — the messaging analogue needs designing rather than erroring.

**Directional channels.** Alice→Bob and Bob→Alice are separate lanes with independent indices.
The thread view stitches them, but the asymmetry leaks into sync: your sends and their arrivals
confirm on different schedules, and the timeline must stay coherent while that happens.

**Registration** itself can be smoothed with `autoRegister: true`, which bundles it into the
user's first real operation instead of demanding a separate transaction upfront.
