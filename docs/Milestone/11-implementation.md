# 12 — Implementation Guide

Build order, with the code that is determined by STRK20's interfaces. Anything marked
**[unverified]** comes from documentation rather than from reading the SDK or pool source, and
must be confirmed before it is relied on.

## Step 0 — Confirm the pure-message path

Everything below assumes a pool transaction can carry an `InvokeExternal` and move no tokens.
The docs say an empty `Span<OpenNoteDeposit>` is valid, and the escrow helper's parked-funds
step relies on it — but every worked example pairs `invoke` with a `transfer` that opens a note.

```ts
// Cheapest possible probe: simulate an invoke-only action list.
const prepared = await account.strk20PrepareInvoke(
  [{ type: "invoke", contract: helperAddress, calldata: [/* one message */] }],
  true,   // simulate — builds and proves without submitting
)
```

If this is rejected, every message must carry a token movement — a dust self-transfer — which
changes cost, UX, and the threat model. **Do this before writing anything else.**

## Step 1 — Freeze test vectors

`vectors/derivations.json`, consumed by both the Cairo and TypeScript test suites:

```json
{
  "channel_key":  { "sender": "0x…", "sender_sk": "0x…", "recipient": "0x…",
                    "recipient_pk": "0x…", "expected": "0x…" },
  "msg_id":       { "channel_key": "0x…", "index": 0, "expected": "0x…" },
  "msg_key":      { "channel_key": "0x…", "index": 0, "expected": "0x…" },
  "packing":      { "bytes": "…base64…", "expected_felts": ["0x…", "0x…"] }
}
```

Generate `channel_key` from the Privacy SDK itself rather than from the documented formula —
the formula is what needs checking, and a vector derived from the shipped code is the ground
truth. **[unverified]** that the documented formula matches the implementation.

## Step 2 — The helper contract

```cairo
use privacy::objects::OpenNoteDeposit;
use starknet::{ContractAddress, get_caller_address};

const MSG_ID_TAG: felt252 = 'STRK20_MSG_ID:V1';

#[derive(Drop, Serde)]
pub struct EncryptedMessage {
    pub msg_id: felt252,
    pub ciphertext: Array<felt252>,
}

#[starknet::interface]
pub trait IMessageAnonymizer<T> {
    fn privacy_invoke(
        ref self: T,
        messages: Span<EncryptedMessage>,
        deposits: Span<OpenNoteDeposit>,
    ) -> Span<OpenNoteDeposit>;

    fn slot(self: @T, msg_id: felt252, offset: u32) -> felt252;
    fn slot_len(self: @T, msg_id: felt252) -> u32;
}

#[starknet::contract]
pub mod MessageAnonymizer {
    use super::{EncryptedMessage, IMessageAnonymizer, OpenNoteDeposit};
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess,
                            StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        pool: ContractAddress,
        /// msg_id -> number of felts stored; 0 means empty (end of the dense list)
        len: Map<felt252, u32>,
        /// (msg_id, offset) -> payload felt
        data: Map<(felt252, u32), felt252>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl MessageAnonymizerImpl of IMessageAnonymizer<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            messages: Span<EncryptedMessage>,
            deposits: Span<OpenNoteDeposit>,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), 'CALLER_NOT_POOL');

            for m in messages {
                let id = *m.msg_id;
                assert(self.len.entry(id).read() == 0, 'SLOT_OCCUPIED');
                let n = m.ciphertext.len();
                assert(n > 0, 'EMPTY_PAYLOAD');

                let mut i: u32 = 0;
                while i != n {
                    self.data.entry((id, i)).write(*m.ciphertext.at(i));
                    i += 1;
                };
                self.len.entry(id).write(n);
            };

            deposits   // pass through; empty span for a pure message
        }

        fn slot(self: @ContractState, msg_id: felt252, offset: u32) -> felt252 {
            self.data.entry((msg_id, offset)).read()
        }
        fn slot_len(self: @ContractState, msg_id: felt252) -> u32 {
            self.len.entry(msg_id).read()
        }
    }
}
```

Three details carry the contract:

- **`caller == pool`** is the only access control needed, and it is also where sender anonymity
  lives — the helper never sees who initiated.
- **`len == 0` means empty**, which is what makes the recipient's dense-index walk terminate.
  Rejecting an occupied slot rather than skipping it is therefore a correctness requirement,
  not just hygiene: a gap silently truncates every future scan.
- **Return the deposits span unchanged.** Returning anything else, or trailing garbage, makes
  the pool reject the call.

### Negative tests that matter

```
direct call from a non-pool address          → CALLER_NOT_POOL
second write to an occupied msg_id           → SLOT_OCCUPIED
empty ciphertext array                       → EMPTY_PAYLOAD
non-empty deposits span passed through       → returned verbatim
```

## Step 3 — Derivations in TypeScript

```ts
import { poseidonHashMany } from "@scure/starknet"   // or the SDK's own export

const MSG_ID_TAG  = BigInt("0x..." /* 'STRK20_MSG_ID:V1'  */)
const MSG_KEY_TAG = BigInt("0x..." /* 'STRK20_MSG_KEY:V1' */)

export const msgId  = (ck: bigint, i: number) =>
  poseidonHashMany([MSG_ID_TAG,  ck, BigInt(i)])
export const msgKey = (ck: bigint, i: number) =>
  poseidonHashMany([MSG_KEY_TAG, ck, BigInt(i)])
```

Prefer the Privacy SDK's own Poseidon export if one is reachable from the package root — a
second implementation is the single most likely source of silent divergence.

## Step 4 — Encrypt and pack

```ts
import { chacha20poly1305 } from "@noble/ciphers/chacha"

const BUCKETS = [256, 1024, 4096] as const
const NONCE = new Uint8Array(12)   // safe: key is unique per message

export function seal(channelKey: bigint, index: number, body: Uint8Array) {
  const id  = msgId(channelKey, index)
  const key = feltToBytes32(msgKey(channelKey, index))

  const bucket = BUCKETS.find(b => body.length + HEADER <= b)
  if (!bucket) throw new Error("message exceeds 4 KiB; chunk it or store off-chain")

  const plaintext = pad(frame(body), bucket)          // version|sender|ts|len|body|pad
  const ct = chacha20poly1305(key, NONCE, feltToBytes32(id)).encrypt(plaintext)
  return { msgId: id, felts: packFelts(ct) }
}

/** 31 bytes per felt, little-endian per chunk. */
export function packFelts(bytes: Uint8Array): bigint[] {
  const out: bigint[] = []
  for (let i = 0; i < bytes.length; i += 31) {
    const chunk = bytes.subarray(i, Math.min(i + 31, bytes.length))
    let v = 0n
    for (let j = chunk.length - 1; j >= 0; j--) v = (v << 8n) | BigInt(chunk[j])
    out.push(v)
  }
  return out
}
```

`msgId` as AAD is what stops a ciphertext being replayed into a different slot. The all-zero
nonce is safe *only* because `key_i` is unique per message — if that ever stops being true,
this becomes a critical bug, so assert it in tests rather than trusting the comment.

## Step 5 — Send

Two paths, depending on which client architecture you take
([12-client-and-ui.md](12-client-and-ui.md)).

### Wallet API path — browser, no viewing key in the app

```ts
import type { STRK20_ACTION } from "@starknet-io/types-js"

const actions: STRK20_ACTION[] = [
  { type: "invoke", contract: helperAddress, calldata: serializeMessages(msgs) },
]
const { transaction_hash } = await account.strk20InvokeTransaction(actions)
```

Calldata order must match `privacy_invoke`'s signature exactly — the pool deserializes it
straight into the function's parameters. Placeholders `${openNoteIds[N]}` and `${poolAddress}`
are available when a memo rides an open note.

### Low-level SDK path — full control, viewing key in the app

```ts
const provingBlockId = (await provider.getBlockNumber()) - 10

const { callAndProof } = await transfers
  .build({ autoSetup: true })
  .surplusTo(account.address)
  .with(token, t => t.inputs(note).transfer({ recipient: bob, amount: 50n }))
  // .invoke(...) — attach the message payload here
  .execute({ provingBlockId })
```

**[unverified]** The low-level builder's `invoke()` signature. Only
`transfers.build().subaccounts(dappName).invoke(...)` appears in the docs; confirm the generic
anonymizer form against
[starkware-libs/starknet-privacy](https://github.com/starkware-libs/starknet-privacy) before
building on it.

### The submission tail

Identical for every operation. Write it once:

```ts
export async function submit(account, provider, callAndProof) {
  const proofDetails = callAndProof.proof.proofFacts?.length
    ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
    : {}                                    // must be OMITTED, never empty arrays
  const tx = await account.execute(callAndProof.call, { tip: 0n, ...proofDetails })
  return provider.waitForTransaction(tx.transaction_hash)
}
```

`tip: 0n` is mandatory for v3. On any failure — revert, `INVALID_NONCE`, replacement
underpriced — call `transfers.invalidateProofNonceCache()` before rebuilding, or the retry
loops on proofs the chain keeps rejecting.

## Step 6 — Discover

```ts
export async function discover(provider, helper, channels, cursors) {
  const found = []
  for (const [peer, ch] of channels) {
    let i = cursors.get(peer) ?? 0
    for (;;) {
      const id  = msgId(ch.key, i)
      const len = await provider.callContract({
        contractAddress: helper, entrypoint: "slot_len", calldata: [id],
      })
      if (BigInt(len[0]) === 0n) break        // dense list ends here
      found.push(await readAndOpen(provider, helper, ch.key, i, Number(len[0])))
      i++
    }
    cursors.set(peer, i)
  }
  return found
}
```

`slot_len` as a single call per index is the naive form and costs one round trip each. Batch
with a multicall, or add a view returning several lengths at once, before this reaches a real
client.

Channel discovery itself is inherited: `transfers.discoverChannels("all", { cursor })`. Note
that this currently requires an indexer — see [07-discovery.md](07-discovery.md).

## Step 7 — Batch

The pool enforces **one `invoke()` per transaction** and the builder errors if you chain two.
Batching therefore happens *inside* one invoke, in the helper's calldata:

```ts
const batch = outbox.take(8)                      // 8 messages, one proof, one fee
const actions = [{ type: "invoke", contract: helper,
                   calldata: serializeMessages(batch.map(seal)) }]
```

Larger batches mean larger proofs, and very large ones can hit proof-size limits. Wrap the
submission in try/catch and fall back to a smaller batch rather than failing the send.
