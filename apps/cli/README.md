# msg — the M3 CLI

Send and read encrypted messages filed under STRK20 channel keys.

```shell
msg init --rpc <url> --helper <addr> --account <addr> [--mode direct|pool]
msg channel add --label bob --peer 0x... --key 0x...
msg channel discover              # pool mode: pull channel keys from the pool's scan
msg send --to bob "hello"        # immediate: queued → (proving) → submitted → confirmed
msg read                          # [1] from 0xALICE · 2 min ago · "hello"

# The outbox is the primary interaction (M4): accumulate, then flush as ONE
# transaction per channel — one proof, one fee, N messages.
msg queue --to bob "first"
msg queue --to bob "second"
msg outbox                        # queued/tier preview before spending anything
msg flush                         # N messages · one InvokeExternal · one tx

# A memo riding a transfer, atomically: if the transfer reverts, so does the memo.
# Pool mode: YOU are the public submitter (by design — 16-arch1-plan.md); who was paid and
# how much are what stay private. The amount rides inside the ciphertext, so the recipient's
# `read`/`history` shows it as a payment.
msg pay --to bob --token 0x... --amount 12345 --memo "invoice #1"

# Sync (M5): rebuild history from chain state alone, resumably.
msg sync --full                   # a fresh client reconstructs everything
msg history                       # full cached history, ordered per channel
msg status                        # synced to block 1,284,332 · 20 message(s) · 5 s ago
```

Sync walks every channel in batched `slot_lens` windows with concurrent payload reads,
persists after every window through an atomic write (temp file + rename), and keys history by
`(channel, index)` — so a scan killed at any point resumes with no gaps and no duplicates,
and the `synced to block` watermark is the block observed before the scan began (never
overstating what has been seen). Channel discovery is the recipient's *only* route to an incoming channel key (only the
sender can derive one), so `msg sync` runs it first in pool mode and `msg channel discover`
runs it alone; discovered channels are merged into `config.channels` without overwriting
hand-added ones ([src/channels.ts](src/channels.ts)). The Privacy SDK is constructed in exactly
one place, [src/poolClient.ts](src/poolClient.ts) — the SDK factory's config path builds its
discovery provider **without** OHTTP, so we construct `IndexerDiscoveryProvider` ourselves and
apply the same OHTTP setting to proving (default on; opt-out is honored but warns). Pool mode
needs `config.pool.discoveryUrl` and a viewing key from env `STRK20_MSG_VIEWING_KEY` (or
`pool.viewingKey`), always coerced to a `bigint` — a hex string silently discovers nothing. In
direct mode channels are provisioned with `msg channel add`.

Pool mode on **Sepolia** needs no operator: run the transaction prover yourself
([docs/15 § B2](../../docs/15-testnet-runbook.md)) and point `config.pool` at it —
`{ sdkPath, poolAddress, provingUrl: "http://127.0.0.1:3000", carrierToken }` with no
`discoveryUrl` (the pool contract is read over RPC) and the viewing key in
`STRK20_MSG_VIEWING_KEY`. OHTTP is off automatically toward a localhost prover.

Flush runs through the resilience loop ([src/resilience.ts](src/resilience.ts)): the
proof-nonce cache is invalidated on every failure, `provingBlockId` (head − 10) is re-fetched
on every attempt and between chained transactions, a proof-size failure falls back to a
smaller batch (halving, remainder chained), and a slot conflict re-seals at fresh indices.
Retries are bounded — a rejected proof never loops.

Config in `~/.strk20-msg` (`STRK20_MSG_HOME` overrides — the e2e test uses two homes as
"machine A" and "machine B"). Private key via `STRK20_MSG_PRIVATE_KEY`. Local state is
`{ channelKey → nextIndex }` and nothing else; deleting it costs a re-walk from index 0.

## Two submission modes

| | `direct` (dev only) | `pool` |
| --- | --- | --- |
| Path | account calls `privacy_invoke` on the helper | STRK20 pool transaction carrying our `InvokeExternal` + a zero-amount carrier note |
| Requires | helper deployed with your account as `pool` | full pool address, registered + funded account, proving service |
| Submitter visible | **yes** | no (further decoupled by a paymaster) |
| Status | **proven end to end on devnet** (`pnpm test:e2e`) | wired per the M0-verified shapes; not yet exercised live |

The submission tail (v3 `tip: 0n`, `proofFacts` omitted-not-empty, proof-nonce-cache
invalidation on failure) is wrapped once in [src/tail.ts](src/tail.ts) and used by both modes.
Discovery is the batched slot walk in [src/walk.ts](src/walk.ts) — `slot_lens` windows of 16,
one RPC round trip per window, stop at the first empty slot.

## e2e

```shell
# needs starknet-devnet v0.8.0-rc.3 on PATH (the pool repo's CI pin; it compiles Sierra 1.8)
RUN_DEVNET_E2E=1 pnpm --filter @strk20-messaging/cli test:e2e
```

Declares + deploys the M2 contract for real, drives the built CLI as child processes from two
separate config homes, and asserts the milestone transcript plus the observer property
(no recipient, no plaintext in calldata).

## What M3-on-Sepolia still needs

1. The full STRK20 Sepolia pool address (docs carry only a truncated form).
2. A funded Sepolia account, registered with `SetViewingKey`, and the proving service URL.
3. Helper deployed via `contracts/deploy/sepolia.sh`.
4. First live pool-mode send: watch the carrier step (`transfer(self, 0n)` compiling to the
   zero-amount `CreateEncNote` the pool sanctions) — verified in pool source, not yet on-chain.
5. Channel keys from the Privacy SDK's channel scan instead of `channel add` provisioning.
