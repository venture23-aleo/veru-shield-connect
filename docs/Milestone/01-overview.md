# 01 — Overview

## What we are building

A private messaging layer on **STRK20**, Starknet's deployed privacy pool. Two pool
participants can exchange encrypted messages such that an observer learns neither who sent a
message, who received it, nor what it said.

The deliverable is deliberately small:

- **`message_anonymizer.cairo`** — an anonymizer (helper) contract implementing
  `privacy_invoke`, which files encrypted payloads into WriteOnce storage slots addressed by
  the sender and recipient's shared channel key.
- **A Privacy SDK extension** — `sendMessage` / `discoverMessages`, layered on the existing
  TypeScript SDK's channel and proving machinery.

That is the whole build. The sections below explain why it is that small.

## What STRK20 already provides

The hard parts of secure messaging are already deployed and audited-in-production on Starknet
Mainnet (`0x040337b1…e812a`) and Sepolia (`0x0254a6b2…e0d91`).

| Requirement | STRK20 already has it |
| --- | --- |
| Key agreement | **ECDH on the STARK curve**, fresh ephemeral key per channel |
| Key registration | `SetViewingKey` action; `K = k·G` registered on-chain, immutable |
| Shared secret per pair | `channel_key = h(CHANNEL_KEY_TAG, sender_addr, sender_sk, recipient_addr, recipient_pk)` |
| Unlinkable addressing | `note_id = h(NOTE_ID_TAG, channel_key, token, index, 0)` — dense, sequential, WriteOnce |
| Discovery without an index | Walk dense indices until the first empty slot; cost scales with *your* activity, not pool volume |
| Caller decoupling at the helper | `InvokeExternal` — the pool calls the helper, so the helper's caller is the pool, never the payer |
| Submitter decoupling | Available (a paymaster relays), but **v1 does not use it**: the payer submits and is public by design — see [16-arch1-plan.md](16-arch1-plan.md) |
| Proof of membership and authorization | STARK proof over a virtual Starknet execution, verified in-protocol |

**Read that table as a list of things not to build.** The tag-derivation scheme, the ECDH
handshake, the anonymity set, the proof system, and the discovery algorithm all exist. A
messaging layer that invents its own versions of these would be strictly worse: a second
anonymity set is a smaller anonymity set.

## The gap this project fills

STRK20 addresses and encrypts *notes* — an amount and a token. Three things are missing for
messages:

**1. A place to put a message body.** Notes carry a masked `u128` amount, not a kilobyte of
text. Message payloads need their own storage, filed under the same channel key so the same
discovery scan finds them.

**2. Authenticated encryption.** STRK20 hides note fields with domain-separated Poseidon
"hash-and-add" masking — cheap, and correct for values whose integrity is already enforced by
the pool's balance invariant. Message bodies have no such invariant behind them: masking
alone is **malleable**, with no MAC. We add a real AEAD over the body. See
[04-cryptography.md](04-cryptography.md).

**3. A helper contract to receive them.** `privacy_invoke` is the composability hook. Our
helper accepts message payloads as calldata, writes them to derived slots, and returns an
empty `Span<OpenNoteDeposit>` when no value moves.

## What this buys, as product

- **Encrypted mail between pool participants** — addresses never appear on-chain.
- **Payment memos** — a message and a transfer in one atomic pool transaction, since both are
  actions in the same action batch. This is the strongest form of the feature: not a
  multicall from one visible account, but a single proven transaction.
- **Escrow and OTC negotiation** — STRK20 already ships an escrow helper pattern; a messaging
  helper makes the negotiation leg private too.
- **A substrate for metadata-resistant messaging** — with one important limit, below.

## The limit you must state out loud

STRK20 escrows every user's private viewing key, encrypted to an auditor's public key, on
chain at registration. An auditor under lawful process can recover `k`, derive that user's
channel keys, and read their history — which, once messages are filed under the same channel
keys, **includes message content**.

This is a deliberate compliance property of the pool, not a flaw, and it is the price of the
anonymity set. But it means this system is **not** suitable for threat models where the
adversary can compel the auditor. Anonymous tips and dissident communication are *not*
supported use cases here. Say so in the product copy rather than discovering it later. See
[02-threat-model.md](02-threat-model.md#the-escrowed-auditor-key).

## What changed from the previous revision

The earlier draft assumed a hypothetical pool and specified a membership circuit, a
Garaga-generated verifier, a bespoke relayer network, a tag-ratchet scheme, and a discovery
indexer. STRK20 supplies functional equivalents of all five. Those components are removed.

The corresponding effort did not vanish so much as move: what remains is integration work
against a live system, plus the three genuinely new constraints in
[09-open-decisions.md](09-open-decisions.md) — proving latency, one `InvokeExternal` per
transaction, and payload storage cost.
