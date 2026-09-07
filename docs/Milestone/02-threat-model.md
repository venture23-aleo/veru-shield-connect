# 02 — Threat Model

## Actors

| Actor | Capability |
| --- | --- |
| **Chain observer** | Reads all Starknet state, transactions, events. Unlimited retention and correlation. |
| **Sequencer** | Everything the observer has, plus mempool visibility and ordering power. |
| **Proving service** | Receives the full witness of every transaction it proves — sender, recipient, token, amount, channel keys. Mandatory: there is no local prover. The strongest non-auditor adversary in the system. |
| **Paymaster** | *Not used in v1* ([16](16-arch1-plan.md)). If reintroduced: sees the transaction before it is public, plus the submitter's network origin and timing. |
| **Auditor** | Holds the escrow key that can recover any registered user's private viewing key under lawful process. **See below.** |
| **Recipient** | Holds the channel key; reads the message and identifies the sender. |
| **Global passive network adversary** | Observes traffic to paymasters and RPC endpoints. Out of scope for v1. |

## What is hidden

> **Revised for Arch 1 (2026-09-07).** The product ships the public-sender shape
> ([16-arch1-plan.md](16-arch1-plan.md)): the payer submits their own transaction and is
> visible. The columns below are written for that. A prover column is added because the
> prover is the strongest adversary on this path.

| Element | Chain observer | Proving service | Paymaster | Auditor |
| --- | --- | --- | --- | --- |
| Sender identity | **Visible — by design.** The payer is `sender_address` and pays the fee | **Visible** | Hidden (sees IP, not pool identity) | **Visible** |
| Recipient identity | Hidden — *except on the first payment to them*, see below | **Visible** | Hidden | **Visible** |
| Amount | Hidden — enc notes pack an encrypted amount | **Visible** | Hidden | **Visible** |
| Message content | Hidden — AEAD under a per-message key | **Visible** | Hidden | **Visible** |
| Sender↔recipient link | Hidden — slot ids are unlinkable without the channel key | **Visible** | Hidden | **Visible** |
| That a pool transaction occurred | **Visible** | Visible | Visible | Visible |
| That the message helper was invoked | **Visible** — the helper's address is public | Visible | Visible | Visible |
| Payload size (bucketed) | **Visible** | Visible | Visible | Visible |
| Block timestamp | **Visible** | Visible | Visible | Visible |

The v1 claim, stated the way the product should state it: **who was paid, and how much, is
private from everyone except the prover and the auditor. Who paid is not.**

## The escrowed auditor key

At registration, STRK20 encrypts the user's private viewing key `k` to an auditor's public key
and stores that ciphertext on-chain. An auditor under lawful process recovers `k`, and from
`k` derives every channel key that user participates in.

Because this design files messages under those same channel keys, **key recovery yields
message plaintext, not just payment history.**

Three consequences, all of which belong in user-facing copy rather than a footnote:

- The system resists chain observers, sequencers, paymasters, and other pool users. It does
  **not** resist an adversary who can compel the auditor.
- Use cases premised on resisting a state-level adversary — anonymous tips, dissident
  communication, whistleblowing — are **out of scope**, and should be removed from any pitch
  rather than qualified.
- Supported use cases are those where compliance disclosure is acceptable or desirable:
  payment memos, OTC and escrow negotiation, professional and commercial confidentiality.

An alternative exists — encrypt bodies under a key derived from material *outside* the pool's
viewing-key hierarchy, so the auditor recovers metadata but not content. That trades away the
"one key, one backup" property and arguably defeats the pool's compliance design. It is a real
decision, not an obvious one: see [D10](09-open-decisions.md#d10--do-we-inherit-auditability).

## Known leaks and mitigations

**The payer is public, so the payer's timing is public.** A payer who sends to one
counterparty at a fixed cadence leaks the relationship even though the recipient is hidden.
*Mitigation:* client-side send jitter; batch memos into one transaction. Partial only.

**Amount privacy is bounded by the note set.** The amount is encrypted, but a payer whose
only note is exactly the right size still narrows it; `autoSelectNotes: "all"` with a change
note is the default for that reason. Read the selection strategy before claiming more.

**Helper invocation is visible.** Every pool transaction reveals which anonymizer it invoked.
A transaction calling `message_anonymizer` publicly says "this was a message," distinguishing
it from a swap or a plain transfer. *Mitigation:* messages riding along with transfers are
indistinguishable from transfers only if the helper is shared with other functions —
otherwise accept that "a message was sent" is public, as it already was in the original design.

**Payload size.** Slot count is public and fingerprints message length. *Mitigation:* pad to
fixed buckets — 256 B / 1 KiB / 4 KiB — enforced in the SDK.

**Timing.** Block timestamps plus cadence permit correlation. *Mitigation:* batch multiple
messages into one `InvokeExternal`, plus client-side send jitter. Partial only.

**Anonymity set size.** Bounded by STRK20's participant count, not by anything here. This is
inherited, dominant, and unfixable at this layer — but it is now a real deployed number rather
than a hypothetical, which is a large improvement over the previous revision.

**Channel-open publishes the recipient — measured, not inferred.** The *first* payment to a
new recipient carries an `Append` server action, and `AppendInput` names `recipient_addr` in
the clear because the pool must know whose `EncChannelInfo` vector to append to
(`packages/privacy/src/actions.cairo:329-334`). Server actions are public calldata. So payment #1
to Bob says "Alice opened a channel to Bob" on-chain; payment #2 onward does not — the
recipient and the amount are both absent from the envelope. Verified in
`apps/cli/test/e2e-pool.test.ts` ("Arch 1"), which asserts both halves.

*Mitigation:* open channels well before, and separately from, the payments that use them —
the same advice STRK20 already gives for deposit/withdraw proximity, now with a specific
mechanism attached. A first payment is never private as to *who*.

**Deposit screening.** Shielding addresses are screened by FPI and each deposit is signed.
Entry to the anonymity set is permissioned; this does not affect messages but does affect who
can send them.

## Non-goals for v1

- **Forward secrecy.** Channel keys are long-lived by STRK20's design — they are derived from
  registered, immutable viewing keys. A ratchet on top is possible but would break the
  property that discovery needs no extra state.
- **Post-compromise security.** No healing after key compromise.
- **Resistance to auditor compulsion.** See above. This is the headline non-goal.
- **Sender anonymity.** Dropped for v1 ([16](16-arch1-plan.md)): it bought nothing the pool
  was not already giving us, and it cost a paymaster dependency. The route back is
  [08](08-submission.md), unchanged.
- **Delivery guarantees or read receipts.** Inclusion is not delivery.
- **Resistance to a global passive network adversary.** Needs mixnet transport.
- **Protection against a malicious recipient.** They can publish plaintext and their key.

## Assumptions

1. STRK20's channel-key derivation and note-id scheme are as documented. **Confirm against
   source.**
2. A helper may be invoked with no token movement (empty `OpenNoteDeposit` span). Documented
   as valid; **confirm against source.**
3. The pool's proof establishes caller authorization, so the helper needs no separate
   membership check beyond `caller == pool`.
4. ~~Paymaster submission genuinely decouples the submitter address, as documented for AVNU.~~
   Not relied on in v1. (`apply_actions` is callable by any address and authorised by proof —
   `interface.cairo`, *Access Control* — so the route exists when wanted.)
