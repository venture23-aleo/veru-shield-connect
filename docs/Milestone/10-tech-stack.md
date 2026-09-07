# 11 — Tech Stack

Most of this stack is determined rather than chosen. The parts that are genuinely open are
marked as such.

## Determined

| Layer | Choice | Why it is forced |
| --- | --- | --- |
| Contract language | **Cairo**, Scarb, `snforge` | The helper must implement `privacy_invoke` and depend on the `privacy` crate for `OpenNoteDeposit` |
| Client language | **TypeScript** | The Privacy SDK and `starknet.js` are TS; no alternative binding exists |
| Runtime floor | **Node.js ≥ 24** | The Privacy SDK's `ohttp-ts` dependency needs modern WebCrypto |
| Chain library | **`starknet@^10.4.0`, pinned** | STRK20 support landed in 10.4.0 and ships on the npm `next` tag — a bare `npm install starknet` resolves to `latest` and silently lacks it |
| Privacy client | **`@starkware-libs/starknet-privacy-sdk`** | Everything routes through `createPrivateTransfers` |
| Proof system | Stwo, via a remote proving service | Not run locally; see [Services](#services-we-depend-on) |

## Chosen

| Concern | Choice | Alternatives considered |
| --- | --- | --- |
| AEAD | **`@noble/ciphers`** — ChaCha20-Poly1305 | WebCrypto AES-GCM: fewer deps but assumes hardware AES and is clumsier in Node/browser parity |
| Poseidon + STARK curve | **Reuse the Privacy SDK's** | A second implementation invites domain-separation divergence, which fails *silently* — discovery returns nothing |
| Monorepo | pnpm workspace | — |
| Cairo tests | `snforge` | — |
| TS tests | `vitest` | — |

## Install

```shell
npm install @starkware-libs/starknet-privacy-sdk
npm install starknet@^10.4.0
```

**The SDK is not on npmjs.com yet** while StarkWare restores its npm org. Until then it is on
GitHub Packages, which needs a token even for public packages:

```shell
gh auth refresh -h github.com -s read:packages
npm config set @starkware-libs:registry https://npm.pkg.github.com
npm config set '//npm.pkg.github.com/:_authToken' "$(gh auth token)"
npm install @starkware-libs/starknet-privacy-sdk
```

Or pin a commit directly, which is the more reproducible option for CI:

```shell
npm install "starkware-libs/starknet-privacy#<commit-sha>"
```

Plan for this in CI from day one — a build that needs a personal GitHub token is a build that
breaks for the next person who joins.

## Services we depend on

None of these are ours to build, and all three are network dependencies at runtime.

| Service | SDK provider | Notes |
| --- | --- | --- |
| **Proving** | `ProvingServiceProofProvider(url, chainId)` | Remote. Receives your *signed invocation* and returns a STARK proof. The most sensitive dependency in the stack. |
| **Discovery** | `IndexerDiscoveryProvider(url, poolAddress, { ohttp: true })` | HTTP indexer. Handles pagination and reorg repair server-side. |
| **Paymaster** | AVNU, or self-hosted | Optional. Decouples the submitting address. |

**Turn on OHTTP.** `{ ohttp: true }` wraps discovery traffic in Oblivious HTTP envelope
encryption, hiding the client's IP from the discovery service. It is free metadata resistance
and should be the default in our extension, not an option.

**A hosted prover sees the witness.** Self-host for sensitive deployments, and make the
choice visible in configuration rather than burying it.

## Repository layout

```
contracts/          Scarb workspace
  src/message_anonymizer.cairo
  tests/            snforge — including negative tests
sdk/                TS extension over the Privacy SDK
  src/
  test/
vectors/            frozen JSON test vectors, consumed by BOTH sides
apps/
  cli/              Node CLI — build this first
  desktop/          later; see 12-client-and-ui.md
```

`vectors/` is the interface between `contracts/` and `sdk/`. Freeze it first and the two
parallelise; skip it and they diverge silently.

## The development loop

**There is effectively no local loop.** Proving is a remote service and the pool lives on
Sepolia and Mainnet. Standing up devnet plus a pool deployment plus a proving service is a
project of its own, so realistic iteration is against **Sepolia at roughly 29 s per proof**.

Three things make that survivable, and all three are worth building before feature work:

- **`strk20PrepareInvoke(actions, true)`** simulates and proves without submitting — the
  cheapest way to catch a calldata-shape mistake.
- **Unit-test everything provable off-chain.** Derivations, AEAD, felt packing and slot
  addressing are pure functions with no chain dependency. Only integration needs Sepolia.
- **`snforge` against a mock pool.** The helper's contract surface is one entry point; test it
  by calling `privacy_invoke` from a mock caller rather than through the real pool.

## Footguns

All documented, all silent, all worth wrapping once:

| Trap | Symptom |
| --- | --- |
| Viewing key passed as a hex string | No error — **wrong channel-key derivation** downstream |
| `tip: 0n` omitted on a v3 transaction | `Cannot mix BigInt and other types` |
| `proofFacts: []` passed rather than omitted | starknet.js serializes an invalid v3 transaction |
| `provingBlockId` omitted | Intermittent failures on immature notes, worse prover cache hits |
| Stale nonce after a failed submit | Retry loops on proofs the chain keeps rejecting — call `invalidateProofNonceCache()` |
| Deep import into `dist/internal/` | `ERR_PACKAGE_PATH_NOT_EXPORTED` — the `exports` map blocks it |

Wrap the submission tail in a single helper (see
[11-implementation.md](11-implementation.md#the-submission-tail)) and never hand-write it.
