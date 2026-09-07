# 05 — Contracts

One contract. No verifier to deploy, no pool modifications, no upgrade proxy.

## The `privacy_invoke` contract

STRK20 calls anonymizer contracts through a fixed interface. The pool deserializes our
calldata into `privacy_invoke`'s parameters and deserializes the return value as
`Span<OpenNoteDeposit>`.

> **Corrected in M2** (verified against pool source and every shipped anonymizer): deposits
> are the *return value only* — there is no `deposits` input parameter. The pool serializes
> the invoke calldata straight into whatever parameters the anonymizer declares, and applies
> whatever deposits span it returns. A pure message returns an empty span. The implemented
> contract in [`contracts/src/message_anonymizer.cairo`](../../contracts/src/message_anonymizer.cairo)
> is the source of truth.

```cairo
use privacy::objects::OpenNoteDeposit;

#[starknet::interface]
pub trait IMessageAnonymizer<T> {
    /// Called by the privacy pool during InvokeExternal (phase 7, at most once per tx).
    fn privacy_invoke(ref self: T, messages: Span<EncryptedMessage>) -> Span<OpenNoteDeposit>;
}

#[derive(Copy, Drop, Serde)]
struct EncryptedMessage {
    msg_id: felt252,           // h(MSG_ID_TAG, channel_key, index)
    ciphertext: Span<felt252>, // AEAD output, 31 bytes per felt
}
```

Rules the pattern imposes, all of which we must satisfy:

- **Return exactly a `Span<OpenNoteDeposit>`** — trailing garbage makes the pool reject.
- **An empty span is valid** and means "credit nothing" — the pure-message case. This is the
  behaviour the escrow helper relies on for its parked-funds deposit step, so the pattern is
  established, though we should confirm it against source ([D12](09-open-decisions.md)).
- **Approve, don't transfer** — irrelevant to us when no value moves. A memo riding a transfer
  needs no deposits either: the transfer happens as pool-native actions in the same
  transaction, never through the helper.
- **One invoke per transaction** — a message batch and a swap cannot share a transaction.

## Implementation sketch

Superseded by the implemented contract —
[`contracts/src/message_anonymizer.cairo`](../../contracts/src/message_anonymizer.cairo), tested
in [`contracts/tests/`](../../contracts/tests/) against the frozen vectors.

Three properties carry the whole contract:

**`caller == pool`.** The only access control needed. Nobody can drive the helper directly,
which is both a security property and the source of sender anonymity at this layer — from the
helper's perspective the caller is always the pool.

**WriteOnce slots.** Matching the pool's own convention. A slot is written once and never
mutated; a second write to an occupied `msg_id` reverts rather than overwriting. This makes
the dense-index scan sound: an empty slot genuinely means "end of the list."

**No key material, no cryptography.** The helper stores opaque felts. Every cryptographic
decision lives in the SDK, where it can be reviewed in TypeScript rather than Cairo.

## Deliberate non-features

No deletion or edit — storage is WriteOnce and pretending otherwise misleads users. No admin
key, no pause, no upgrade proxy: an upgradeable message helper is one whose operator could
begin recording metadata, and the trust story is worth more than the ability to patch. Version
by deploying a new helper and pointing the SDK at it.

## Pool integration

**No pool modifications** — a checked claim: nothing in this repo touches pool code, and the
helper conforms to `privacy_invoke` compiled against the pinned pool source
(`starknet-privacy` @ `bc75e4ba`).

What is *not* yet true, stated plainly so this section stops implying it: **no transaction of
ours has gone through a deployed pool.** The mechanics are proven on **devnet against the real
pool contract** ([`e2e-pool.test.ts`](../../apps/cli/test/e2e-pool.test.ts), mock proving); the
Sepolia helper still carries `pool` = the deployer account (dev mode), and the live path is
blocked on the proving endpoint ([15 § B2](15-testnet-runbook.md)) and the Phase-B redeploy
([16 § W1](16-arch1-plan.md)). The addresses `0x040337b1…e812a` (Mainnet) /
`0x0254a6b2…e0d91` (Sepolia) were recovered by scanning, not transacted with, and their
immutability is assumed rather than verified.

The previous revision's blocking question about historical Merkle roots does not apply — STRK20
does not have us prove against a root. Its analogue is **anchor-block recency**: a proof is
generated against a recent block snapshot and is rejected if the anchor is older than
`proof_validity_blocks`. With ~29 s of proving, that window must comfortably exceed proving
plus submission time. See [D2](09-open-decisions.md#d2--the-proof-validity-window).

### Deployed

| Network | Address | Pool it is pinned to | Deploy tx |
| --- | --- | --- | --- |
| **Mainnet** | [`0x030a2a39…b3a6`](https://voyager.online/contract/0x030a2a39c47adba579c8fd07e7d9adbf5fe8f36b97da0b6ead884cae3a8bb3a6) | `0x040337b1…812a` (STRK20 mainnet pool) | [`0x07f38182…`](https://voyager.online/tx/0x07f38182c93bd902e8d3830b86a4f1acc0be90f629ba396e7ea3a513ae9fb8e8) · declare [`0x04053469…`](https://voyager.online/tx/0x040534693d8cbb2f9d871d5f3195fcdbaa51892c01ebc49e68900d485c69b6f7) |
| Sepolia | [`0x016f77a5…f6e0b6`](https://sepolia.voyager.online/contract/0x016f77a566ed28f2945e315f2de971b8f3e83a03b93340e8927a311277f6e0b6) | `0x254a6b29…e0d91` (STRK20 Sepolia pool) | [`0x0425af6d…`](https://sepolia.voyager.online/tx/0x0425af6dad2ce028c83918ce64feee9d0351f4cd8a83325a6b934eaf19e6537e) |

Full records, class hashes and fees: [DEPLOYMENTS.md](../../DEPLOYMENTS.md). Mainnet was deployed
2026-09-07 with the same class as Sepolia after checking that the mainnet pool's newer class
still invokes external contracts through `privacy_invoke` ([21](21-mainnet-deployment-checklist.md)).

## Cost sketch

The dominant on-chain cost is **storage**: one WriteOnce slot per 31 bytes of payload, billed
as L1 data gas. A 1 KiB message is ~34 slots.

This is a large per-message cost and it is the strongest argument for keeping padding buckets
small and for [D9](09-open-decisions.md#d9--where-does-the-payload-live), which asks whether
bodies belong in storage at all. Benchmark a 256 B and a 4 KiB message on Sepolia before
committing to the storage-slot design — it is a cheap experiment that constrains the product.
