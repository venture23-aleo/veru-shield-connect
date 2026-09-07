# @strk20-messaging/sdk

The messaging extension to Starknet's Privacy SDK. Pure TypeScript, browser- and Node-safe
(crypto is `@scure`/`@noble` only). It turns a plaintext message into the calldata a pool
transaction carries, and turns derived storage slots back into plaintext. It holds no keys
beyond what the caller passes and talks to no network itself.

Part of [VeruShield Connect](../README.md). See [docs/Milestone/06-sdk.md](../docs/Milestone/06-sdk.md)
for the design and [04-cryptography.md](../docs/Milestone/04-cryptography.md) for the
derivations.

## What it provides

| Area | Exports | Purpose |
| --- | --- | --- |
| **Derivations** | `msgId`, `msgKey`, `MSG_ID_TAG`, `MSG_KEY_TAG` | Address a message slot from a channel key: `msg_id = h(MSG_ID_TAG, channel_key, index)`, dense and write-once. Verified byte-for-byte against Cairo reference vectors. |
| **AEAD** | `seal`, `open`, `openCiphertext`, `CT_LEN` | ChaCha20-Poly1305 under a per-message key `h(MSG_KEY_TAG, channel_key, index)`. |
| **Framing** | `frame`, `unframe`, `bucketFor`, `BUCKETS` | Pad a body to a fixed size bucket (256 B / 1 KiB / 4 KiB) so length does not leak. |
| **Felt packing** | `packFelts`, `unpackFelts` | 31 bytes per `felt252`, the pool's own convention. |
| **Calldata** | `privacyInvokeCalldata`, `splitBatch`, `calldataFeltCount` | Build the `InvokeExternal` calldata for the helper; batch many messages into one invoke. |
| **Payments** | `encodePaymentMemo`, `decodePaymentMemo`, `encodePaymentRequest`, `decodePaymentRequest` | The `PAY1` / request memo formats carried inside the AEAD body. See [19-payments-in-chat.md](../docs/Milestone/19-payments-in-chat.md). |
| **Groups** | `groupLaneKey`, `GROUP_LANE_TAG` | Per-member encrypted lanes for group threads. |
| **Outbox** | `Outbox`, `MemoryStore`, `tierOf` | Batch, queue, and flush sends — many messages, one transaction. |
| **Sync** | `SyncEngine`, `MemorySyncStore` | Walk derived slots over a `SlotReader` and rebuild history from chain state alone. |
| **Dev channel** | `devPairLane` | Deterministic lane for direct/dev mode, no pool channel required. |

## Use

```bash
pnpm --filter @strk20-messaging/sdk build
pnpm --filter @strk20-messaging/sdk test
```

```ts
import { frame, seal, msgId, privacyInvokeCalldata } from "@strk20-messaging/sdk";

// Encrypt one message for a channel at a given index, then build helper calldata.
const framed = frame(new TextEncoder().encode("gm"));
const sealed = seal({ channelKey, index, plaintext: framed });
const calldata = privacyInvokeCalldata([sealed]);   // -> InvokeExternal calldata
```

The channel key comes from the Privacy SDK (sender derives it; recipient obtains it through
channel discovery). This package never derives or stores it.

## Tests

`vitest`, including a payment-memo round-trip and derivations checked against the Cairo
reference fixtures in [../vectors/](../vectors/). Run `pnpm --filter @strk20-messaging/sdk test`.
