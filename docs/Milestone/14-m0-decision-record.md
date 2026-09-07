# M0 — Decision Record

**Date:** 2026-09-04.
**Method:** every claim below was verified against the STRK20 source at
[starkware-libs/starknet-privacy](https://github.com/starkware-libs/starknet-privacy),
commit `bc75e4ba` (2026-09-01), by reading the Cairo pool, the TypeScript SDK, and their
tests — and, where marked **[ran]**, by executing code. Spike scripts live in
[`spikes/`](../../spikes/).

## The four exit questions

| Question | Answer |
| --- | --- |
| Is the pure-message path available? | **Yes, conditionally** — no token movement needed, but every message transaction must carry one `WriteOnce` action; a **zero-amount `CreateEncNote`** is the sanctioned, free carrier. No dust transfer. |
| Option A or Option B? | **Option A** (inherit STRK20 keys). The SDK bundles into a stock Vite app, so Option B is no longer forced by tooling — it remains available as a deliberate *auditability* choice ([D10](09-open-decisions.md)). |
| Storage or events for payloads? | **Helper storage.** At current blob prices, DA for even a 4 KiB message is ~0.0006 STRK (~$0.00002) on Mainnet. Storage cost is not the driver the design feared. |
| Per-message cost and latency for the user? | **~30–60 s** (≈29 s proving + submission + confirmation) and **well under one cent** at current prices. L2 execution gas and prover fees are the unmeasured remainder — first real transaction in M2/M3 pins them. |

---

## S1 — Zero-value invoke (resolves [D12](09-open-decisions.md))

**Verdict: a literally invoke-only transaction is rejected; a token-movement-free one is valid
with a free carrier action.**

- The pool's client-action loop requires at least one action that produces a `WriteOnce`
  server action: `assert(has_replay_protection, errors::NO_REPLAY_PROTECTION)`
  (`packages/privacy/src/privacy.cairo:309`). `InvokeExternal` compiles only to
  `ServerAction::Invoke`, which does **not** set the flag (`privacy.cairo:535-541`, `:769`).
  A passing pool test asserts `[InvokeExternal]` alone panics with `NO_REPLAY_PROTECTION`
  (`test_client.cairo:4957-5011`).
- The balance invariant is **not** an obstacle: it iterates a dict of touched token balances
  and passes trivially when no tokens move (`objects.cairo:22-27`).
- An **empty `Span<OpenNoteDeposit>` return is an explicitly supported no-op** — the entire
  deposit path is inside `if !deposits.is_empty()` (`privacy.cairo:1004-1008`), and server
  tests confirm an invoke funding nothing is neither screened nor refused
  (`test_server.cairo:3001`, `:3018`).
- **The carrier:** `CreateEncNote` with `amount: 0` is explicitly sanctioned in the pool
  source ("Zero `amount` is allowed…", `actions.cairo:102-103`) and proven by
  `test_create_and_use_encrypted_note_zero_amount` (`test_client.cairo:2083`). It moves no
  tokens, passes the balance check, and provides the `WriteOnce`. The resulting note is
  unspendable and permanently burns one note index per message transaction — acceptable.
  Avoid `CreateOpenNote` (forces a real deposit) and `UseNote` (needs a non-zero note).
  > **Execution addendum (2026-09-05):** the pool accepts zero, but the shipped SDK's
  > client-side validation rejects it ("Created note amount must be positive"). The
  > working carrier through the current SDK is a **1-wei enc-note self-transfer** —
  > still zero *public* token movement. Proven against the real pool contract in
  > `apps/cli/test/e2e-pool.test.ts`; upstream a zero-note exemption or track SDK releases.
- **One invoke-phase action per transaction is Cairo-enforced** (`actions.cairo:302-315`),
  and note creation must precede the invoke (phase ordering). Batching therefore happens
  inside the helper's calldata, exactly as designed — and a message can never share a
  transaction with a swap or any other anonymizer call.
- `InvokeExternalInput` validates only a non-zero target address; calldata is arbitrary and
  unbounded (`actions.cairo:203-208`) — good for payloads.
- The pool always calls the fixed selector `privacy_invoke` on the target
  (`utils.cairo:84`, `privacy.cairo:882`) — our helper's interface matches.

**Design change required:** the SDK wrapper's `buildSend` must automatically add one
zero-amount `CreateEncNote` to every message-only action list. Update
[05-contracts.md](05-contracts.md)/[11-implementation.md](11-implementation.md) framing from
"empty action list plus invoke" to "carrier + invoke".

## S2 — Browser bundling (resolves the [12-client-and-ui.md](12-client-and-ui.md) fork)

**Verdict: the Privacy SDK bundles into a stock Vite 7 app with zero configuration.** [ran]

- `vite build` on a minimal app importing `createPrivateTransfers` from the package root:
  158 modules transformed, **399.79 kB bundle (105 kB gzip)**, no config, no polyfills.
- The repo itself ships browser support we didn't know about: a `./browser` export and an
  esbuild `build:browser` script; that bundle (829 kB ESM) contains **zero Node builtins**. [ran]
- **The trap:** the Poseidon hash helpers (`compute_channel_key` etc.) are only exported via
  the **`/testing` subpath, which is Node-only** — it drags in devnet code importing
  `fs`/`path`/`url` and breaks the Vite build. For a browser client, vendor the generated
  `sdk/src/utils/hashes.ts` (tiny, machine-generated from Cairo) or upstream a `./hashes`
  export.
- Node floor: the SDK has **no `engines` field** and built + ran cleanly on Node 22.23.1.
  The documented "Node ≥ 24" floor did not bite at build time; treat it as unconfirmed for
  runtime `ohttp-ts` use.

**Consequence:** Option B is not forced. Client architecture stays **Option A, CLI-first
(M3), with a browser client viable** pending one residual: a runtime smoke test in a real
browser (bundling ≠ running; WebCrypto/OHTTP paths untested here).

## S3 — Payload cost (resolves [D9](09-open-decisions.md))

**Verdict: helper storage. DA cost is negligible at current blob prices.** (Modeled from live
gas prices, 2026-09-04 — Sepolia block 14,535,925 / Mainnet block 14,345,311, both
Starknet v0.14.3; not yet measured on a live transaction.)

Model: each written storage slot costs 2×32 B of blob data ≈ 64 L1-data-gas. A message of
bucket *B* writes `ceil((B+16)/31)` payload slots + 1 length slot + ~3 slots for the
zero-amount carrier note and pool bookkeeping.

| Bucket | Slots | Sepolia DA (STRK) | Mainnet DA (STRK) | Mainnet DA (USD @ $0.027) |
| --- | --- | --- | --- | --- |
| 256 B | 13 | 0.00064 | 0.000054 | ~$0.0000015 |
| 1 KiB | 38 | 0.00187 | 0.000159 | ~$0.0000043 |
| 4 KiB | 137 | 0.00673 | 0.000574 | ~$0.0000157 |

- Mainnet L1-data-gas was 6.5×10⁻⁸ STRK/gas at measurement — blob space is currently cheap.
  The docs' "storage is the most expensive option" worry is muted; the real per-message cost
  will be dominated by **L2 execution gas + proving**, which are the same under every D9
  option.
- Decision: **keep helper storage** — consistent with the pool's own convention, discovery
  stays a plain RPC read, no availability dependency. Events/hybrid remain a fallback if
  blob prices regress by orders of magnitude (they are volatile; the model, not the
  conclusion's margin, is the fragile part).
- ~~**Residual:** the empirical Sepolia benchmark~~ **Closed 2026-09-04** with real Sepolia
  receipts ([15-testnet-runbook.md](15-testnet-runbook.md) § A6): 256 B message =
  **0.2076 STRK** (~$0.006), 4 KiB = **2.3185 STRK** (~$0.063), direct mode. The model's
  conclusion (storage stays) survives, but its emphasis was wrong: DA really is negligible —
  the fee is **~93% L2 execution gas** from the per-felt storage writes, scaling linearly
  with payload size. The cost driver argument for small padding buckets holds, for the
  execution reason rather than the DA reason. Public RPC note: BlastAPI is dead; `starknet-sepolia.drpc.org` and
  `rpc.starknet.lava.build` (mainnet) work.

## S4 — Derivations and the builder's `invoke()` (verification list items 1 and the builder)

**Verdict: derivations verified byte-for-byte; the generic invoke exists in callback form.** [ran]

- `channel_key = h(CHANNEL_KEY_TAG, sender_addr, sender_sk, recipient_addr, recipient_pk)`
  — **confirmed**. `h` is a **single** `poseidonHashMany` over `[tag, …inputs]` (the SDK's own
  JSDoc claiming a double hash is stale — the Cairo is single, `hashes.cairo:43-46`). Tags
  are Cairo short strings of the form `"CHANNEL_KEY_TAG:V1"`, `"NOTE_ID_TAG:V1"`.
- `note_id = h(NOTE_ID_TAG, channel_key, token, index, 0)` — confirmed; trailing `0` is a
  hardcoded reserved felt.
- **[ran]** `spikes/s4-derivations.mjs` reproduces both from (a) the SDK's built exports and
  (b) an independent 5-line reimplementation over `@scure/starknet` — all four values match
  the SDK's Cairo-generated fixture (`sdk/tests/fixtures/cairo-reference-data.json`):
  `channel_key(0x123, 0x789, 0x456, 0xabc) = 0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948`.
  Our own `STRK20_MSG_ID:V1` / `STRK20_MSG_KEY:V1` tags land in a distinct namespace. The
  M1 vectors can be generated exactly this way.
- Poseidon comes transitively from **`@scure/starknet` 1.1.0** via `starknet` (pinned
  **10.5.0** in the SDK — our docs say `^10.4.0`; match the SDK's pin).
- **Builder `invoke()` found** (`sdk/src/interfaces.ts:708-717`): it takes a **callback**
  `(args: { openNotes, withdrawals, poolAddress }) => CallDetails` — resolved bigints, no
  `${…}` template strings at this layer (those live in the higher-level `client/` package
  wallet route). `CallDetails.entrypoint` is **ignored**; the pool always calls
  `privacy_invoke`. The SDK README's `.invoke({ contractAddress, entrypoint, calldata })`
  example does not compile — trust the callback form.
- **Asymmetry that matters for messaging:** only the **sender** can *derive* `channel_key`;
  the recipient obtains it by **decrypting** the channel record via ECDH during channel
  discovery. Our discovery loop must source channel keys from the Privacy SDK's channel
  scan (as designed), not by re-deriving.
- Viewing key is a plain `bigint` in `[1, n/2]` (`MAX_VIEWING_KEY`), no wrapper type — the
  "hex-string viewing key" footgun is real; our wrapper should enforce `bigint` at the
  boundary.

## Supply-chain notes (unblocks CI planning)

- The SDK is **not on npmjs**; GitHub Packages needs a token (`gh` is currently
  unauthenticated on this machine). A plain **`git clone` of the public repo works without
  auth**, `npm ci` + `npm run build` succeed on Node 22 — commit-pinning the repo is the
  reproducible CI path, as [10-tech-stack.md](10-tech-stack.md) recommends.
- The full deployed pool addresses are not in the repo or the public docs pages we could
  reach (our own docs carry truncated forms). Obtain the full Sepolia address before M2 —
  from the STRK20 team or an explorer — it is also the prerequisite for reading real pool
  transaction receipts.

## What M1/M2 inherit from this record

1. `buildSend` adds a zero-amount `CreateEncNote` carrier to message-only transactions (S1).
2. Vectors are generated with the exact recipe in `spikes/s4-derivations.mjs` (S4 → M1).
3. The helper keeps `privacy_invoke` as its single entry point — selector confirmed (S1/S4 → M2).
4. Payloads stay in helper storage; padding buckets 256 B / 1 KiB / 4 KiB stand (S3).
5. Pin `starknet@10.5.0` to match the SDK, not `^10.4.0` (S4).
6. Residuals: browser **runtime** smoke test; empirical fee receipt on Sepolia (with M2);
   full pool address; GitHub Packages auth or commit-pin decision for CI.
