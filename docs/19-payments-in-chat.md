# 19 — Payments in chat: pay, request, split, receipt

**Added 2026-09-07.** The four value actions the thread and group views expose, all on the
Arch 1 shape ([16](16-arch1-plan.md)): the payer is public, the recipient and the amount are
private, and the memo rides in the same STRK20 pool transaction as the transfer.

| Action | Where | On-chain shape | What the chain sees |
| --- | --- | --- | --- |
| **Send STRK** | thread → 💸 send STRK | 1 private transfer + `privacy_invoke` with a `PAY1` memo | you submitted a pool tx that also called the helper |
| **Request** | thread → 🧾 request | an ordinary message (`REQ1 <token> <amount>\n<text>`) — carrier note + invoke | a message-sized pool tx |
| **Split / tip** | group → 💸 split / tip | N private transfers (one note per member) + one `PAY1` memo on your group lane | one pool tx, N enc notes, one helper call |
| **Receipt** | recipient's thread | none — a read: discovery lists our notes, the memo's amount is matched against them | nothing |

## Formats

- `PAY1` (binary, [sdk/src/payment.ts](../sdk/src/payment.ts)): `magic 4 B · token 32 B · amount u128 16 B · utf-8 text`. Inside the AEAD.
- `REQ1` (text, same file): `REQ1 0x<token> <amount>\n<text>`. Text on purpose — a request moves no
  value, so it takes the outbox → batch path and costs the requester no pool balance. The
  payer's client renders a **Pay** button that pre-fills the pay panel.
- **Settlement** is client-side and pure ([contacts.ts `settleRequests`](../apps/web/src/lib/contacts.ts)):
  a request is settled by the first later payment *from the other direction* with the same
  token and amount; each payment settles at most one request. The chain has no notion of it.

## Amounts

People type STRK (`2.5`); the pool moves u128 smallest units. STRK is the one token whose
decimals we pin (18, same address on Sepolia/mainnet/devnet); anything else is entered and
shown in smallest units, labelled as such ([amounts.ts](../apps/web/src/lib/amounts.ts)).

## Group splits

A split is one transaction: `builder.with(token, t => { t.transfer(...) × N })` plus one memo on the
payer's group lane naming the recipients (`to bob, carol — dinner`). The group reads the memo
(shared key), so members see who was paid what; the pool sees N encrypted notes. Every
recipient must be registered on the pool — the note is encrypted to their key. Proof size grows
with N; keep splits to a handful of members on mainnet.

## Receipts

The recipient's memo says "you received X"; the pool's discovery says which unspent notes are
ours. The thread pairs them by amount, oldest memo first, and shows **✓ receipt** when a note
matches. This is the only pairing possible: the note's amount is encrypted and its recipient
lives in the proof, so chain state alone never links a memo to a note. A note that was already
spent, or not yet indexed, shows as pending — the wording says so.

## Demo mode

The public demo has no pool, so `DemoBackend` simulates one: 100 STRK of notes at genesis,
spends produce a change note, a request is answered by the demo counterparty with a payment,
and receipts resolve against the simulated notes. Same UI, same formats, same code paths
above the backend interface. It says "demo" everywhere it matters.

## Privacy, stated plainly

- Payer: **public** (Arch 1).
- Payee and amount: **private** from the second payment to a peer onward; the first opens a
  channel, whose `Append` names the recipient in calldata ([16 § correction](16-arch1-plan.md)).
- Request text and amounts: private (inside the AEAD), on both lanes.
- Group memos: visible to every group member by design; private from the chain.
