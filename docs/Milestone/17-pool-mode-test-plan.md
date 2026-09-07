# 17 — Pool mode test plan

Everything that has to be true for pool mode ([16](16-arch1-plan.md)) to be trusted, from the
build to Sepolia. Status per item: **auto** = asserted by a test that runs today; **manual** =
needs a human in a browser; **gap** = not covered yet; **blocked** = needs the Sepolia proving
endpoint ([15 § B2](15-testnet-runbook.md)).

Automated coverage lives in three places: [`sdk/test`](../../sdk/test) (unit),
[`apps/cli/test/e2e-pool.test.ts`](../../apps/cli/test/e2e-pool.test.ts) and
[`apps/web/test/pool.e2e.test.ts`](../../apps/web/test/pool.e2e.test.ts) (both against the real
pool contract on devnet, mock proving — gated on `RUN_POOL_E2E=1 STARKNET_PRIVACY=<checkout>`).

## A. Environment

| # | What must be true | Status |
| --- | --- | --- |
| A1 | Privacy SDK checkout builds (`sdk/dist`), pool artifacts build (`scarb build -p privacy`), our helper builds | auto (the e2e gate) |
| A2 | `scripts/pool-devnet.mjs`: devnet up, helper deployed with `pool()` = the pool, alice & bob registered and shielded, settings block printed, stays up, clean shutdown with no orphan | manual — trialled 2026-09-07 |
| A3 | App builds **without** `STARKNET_PRIVACY` (stub) and **with** it (SDK chunks present) | auto (`pnpm run build` both ways) |
| A4 | Browser can reach devnet cross-origin (`access-control-allow-origin: *`) | verified 2026-09-07 |
| A5 | Dev server serves the checkout (`server.fs.allow`); the production bundle needs no runtime access to it | manual |

## B. Settings and connection

| # | What must be true | Status |
| --- | --- | --- |
| B1 | Pool card without the SDK: explains what is missing, Save disabled | manual |
| B2 | Paste the devnet block → every field fills, local mode on, account chooser shows alice/bob, Save → "connected: pool · local devnet" | manual |
| B3 | Sepolia preset fills helper (Phase B), pool, carrier; Save is blocked while proving/discovery URLs are empty and local is off | manual |
| B4 | Non-hex helper / pool / account / key / viewing key / carrier blocks Save and marks the field | manual |
| B5 | Switching pool → direct → pool keeps each mode's own helper field; pool never clobbers direct's | manual |
| B6 | Reload: config persists, backend reconnects, `isPool` true | manual |
| B7 | Devnet block parser accepts the real block and rejects near-misses | auto (`logic.test.ts`) |

## C. Registration and contacts

| # | What must be true | Status |
| --- | --- | --- |
| C1 | `isRegistered` reads `get_public_key` from the pool: seeded peer → true, random address → false | auto (web e2e) |
| C2 | Deriving a lane to an unregistered peer throws a "not registered" error, never a silent key | auto (web e2e) |
| C3 | Adding an unregistered contact shows the "can't receive yet" screen; after they register, **Check again** derives the lane and enables compose | manual |
| C4 | Adding your own address is refused | manual |
| C5 | The sender-side derivation equals the channel the SDK opens — bob **discovers** exactly the key alice derived | auto (web e2e) |
| C6 | Discovery: outgoing lanes from `discoverChannels`, incoming from the notes cursor, self-channel skipped | auto (web e2e) |
| C7 | An incoming lane from an unknown address auto-creates a contact ("someone paid you first") | **gap** |
| C8 | Re-adding an existing pool contact keeps its discovered `inKey` and `setupDone` | **gap** |
| C9 | Invites and address-derived lanes are hidden in pool mode (pairing is the pool) | manual |

## D. Payments — the core action

| # | What must be true | Status |
| --- | --- | --- |
| D1 | **pay**: transfer + memo in one transaction, submitted from the payer's own account | auto (web e2e, CLI e2e) |
| D2 | The memo decrypts as a payment (token, amount, text) on the recipient's side | auto (web e2e) |
| D3 | Payment bubbles render amount + token; a plain message renders unchanged | auto (`logic.test.ts` stitch) + manual |
| D4 | First payment opens the channel; recipient finds the lane after **discover** | auto (web e2e) |
| D5 | First payment names the recipient in calldata (`Append`); the **second** does not, and the amount never does | auto (CLI e2e) — **gap** in the web e2e |
| D6 | **Back-to-back payments**: the change note from payment #1 is spendable in payment #2 (`autoSelectNotes: "all"` + `surplusTo` really routes surplus) | **gap** — the single most important missing case |
| D7 | Paying more than the shielded balance → flush *failed* with the reason; nothing stuck in proving | **gap** |
| D8 | Paying in a token you hold no notes of → clear error | **gap** |
| D9 | Amount 0 / non-numeric → button disabled; non-hex token → disabled | manual |
| D10 | Pay is disabled while a flush is proving/submitted | manual |
| D11 | Paying an unregistered contact is impossible (compose blocked) | manual |

## E. Messages without value

| # | What must be true | Status |
| --- | --- | --- |
| E1 | Send batch → 1-wei carrier to self + invoke; first contact adds `setup(peer)`; the peer discovers the lane and reads the message | auto (web e2e: bob → alice) |
| E2 | A message over an already-open channel must not re-open it: the pool's channel marker is write-once, so an explicit second `setup(peer)` reverts. Fixed by addressing the zero-amount carrier note **to the peer** — `autoSetup` opens the channel only when missing; no local flag | **done** 2026-09-07 — live: `0x7a43b60e…2c22` over an open channel, count unchanged; web e2e covers first contact |
| E3 | Missing carrier token → clear error before proving | **gap** |
| E3b | The carrier is a **zero-amount** note (no funds needed) and the pool accepts it; a later payment never selects that zero note as an input | auto (CLI e2e: message then payment) |
| E3c | Fee pre-flight: with allowance < `get_fee_amount`, an approval tx precedes the pool tx; zero fee (devnet) → no approval | **gap** — exercised live on Sepolia first |
| E4 | Several queued messages to one contact ride one transaction; two contacts → two transactions | **gap** (covered in demo/direct, not pool) |
| E5 | A failed batch returns messages to *queued*, retryable | auto (store logic, demo) — manual in pool |
| E6 | Groups in pool mode: lanes are invite-shared random keys, so they need no pool channel — messages still ride a pool tx with the carrier | **gap** — decide and test |

## F. Sync and reading

| # | What must be true | Status |
| --- | --- | --- |
| F1 | Sync runs discovery first, then walks every known lane; undiscovered (empty) lanes are skipped without error | auto (`logic.test.ts`) + manual |
| F2 | A reply arrives: discover → sync → stitched in order with the sent lane | manual (two browsers) |
| F3 | Sync is resumable across reloads (watermark, no duplicates) | auto (sdk sync tests) |
| F4 | Backup/restore in pool mode: viewing key + contacts restore; out-lanes re-derive, in-lanes re-discover, history rebuilds | **gap** |
| F5 | **Wrong viewing key discovers nothing** — no error, no lanes, no notes (the M0 § S4 footgun, as a negative test) | mitigated: the app compares `getStarkKey(viewingKey)` with the pool's registered key and shows a red banner on mismatch — negative test still a **gap** |
| F6 | **Stale outbound lane after a viewing-key change**: a contact added under the wrong key keeps a lane nobody reads; a send then succeeds on-chain and lands in the void (Brave's `0x604e0cc7…`, msg_id on a different lane than `msgId(lane, 3)`). Fixed: `reconcileLanes()` re-derives every registered contact's lane on (re)connect | **done** 2026-09-07 — unit/e2e coverage still a **gap** |

## G. Proving and submission mechanics

| # | What must be true | Status |
| --- | --- | --- |
| G1 | Local: prove at head, mine 10 blocks, submit → accepted | auto (web e2e) |
| G2 | Live: prove at head − 10; proof accepted inside the 450-block validity window | blocked |
| G3 | On any submission failure the proof-nonce cache is invalidated and the next attempt succeeds | **gap** |
| G4 | A reverted transaction surfaces its `revert_reason` in the flush bar | **gap** |
| G5 | Spending a note younger than 10 blocks (bob pays alice straight back on devnet) fails or waits as expected — define the UX | **gap** |
| G6 | Proof-size ceiling: a 4 KiB memo + transfer still proves (the halving fallback exists in the CLI, not the web) | **gap** |

## H. Privacy properties (assert, don't assume)

| # | What must be true | Status |
| --- | --- | --- |
| H1 | The payer **is** `sender_address` — the deliberate Arch 1 property | auto (web e2e, CLI e2e) |
| H2 | Recipient absent from calldata from the second payment on; present on the first | auto (CLI e2e) — add to web e2e |
| H3 | Amount absent from calldata on every payment | auto (CLI e2e) — add to web e2e |
| H4 | Helper storage holds ciphertext only; slot ids unlinkable without the channel key | auto (sdk vectors) |
| H5 | The envelope assertions have positive controls (helper address present), so they cannot pass vacuously | auto (CLI e2e) — add to web e2e |

## I. Browser runtime (the part Node cannot prove)

| # | What must be true | Status |
| --- | --- | --- |
| I1 | The SDK actually **runs** in a browser: Poseidon, ECDH, WebCrypto paths, `BigInt` everywhere — M0 § S2 proved it *bundles*, never that it runs | **gap** — highest priority manual/Playwright item |
| I2 | Two-browser walkthrough: messages both ways, discovered and read on each side | **done live on Sepolia** 2026-09-07 (Safari ↔ deployer; deployer side read via CLI, Brave window pending) — payments still need funds |
| I3 | Flush bar shows proving → submitted → confirmed honestly; local mock proving is near-instant, so the bar must not lie about 29 s | manual |
| I4 | Private keys live in `localStorage` — the UI says testnet-only; production builds strip the dev-signer prefill | manual |
| I5 | No console errors through the whole flow | manual (Playwright) |

## J. Sepolia — blocked on the proving endpoint

| # | What must be true | Status |
| --- | --- | --- |
| J1 | A real prover: **self-hosted transaction prover** against Cartridge's v0.10 RPC — a registration proved in 8.2 s ([15 § B2](15-testnet-runbook.md)); discovery straight from the pool contract over RPC | **auto** (dry run, `scripts/sepolia-prove-register.mjs`) |
| J2 | First live transaction: the registration accepted on-chain (proof compatibility with the Sepolia pool class) | **done** 2026-09-07 — `0x7c0196fc…5700e`, via the gateway ([15 § B7½](15-testnet-runbook.md)) |
| J2a | Submission goes to StarkWare's gateway, never the RPC's write path (`invalid signature` there); browser via the `/gateway` proxy | auto (script) · manual (UI) |
| J2b | First live **message** through the Phase-B helper — zero-amount carrier, no funds, pool calls `privacy_invoke` on Sepolia | **done** 2026-09-07 — `0x76a93b3b…9a72`, `0x67824552…8687` ([15 § B8](15-testnet-runbook.md)) |
| J2c | First live **payment** through the helper; needs notes → a screened deposit or an internal transfer from a pool participant | blocked on the operator's screening (deposit reverts: `0x63c8aae0…022a`) |
| D12 | **The whole payment flow**: shield (approve + proven Deposit) → pay with memo from the shielded note → change note back → recipient discovers and reads the payment | **auto** (web e2e, real pool contract on devnet) — the app's **Shield** control is the same path, proving through an optional screening prover URL |
| J2d | First send to a peer opens the channel (`setup(peer)`) in both clients — without it the recipient can never discover the lane | auto (web e2e) · CLI fixed 2026-09-07, covered live |
| J3 | Observer check on Voyager: pool + helper + size + timestamp visible; payee and amount absent (B9) | blocked |
| J4 | Fees measured for a payment + memo at each padding tier | blocked |
| J5 | Screening: a real deposit reverts with `SCREENING_REQUIRED` — proven live (`0x71c94245…9c95`, [15 § B10](15-testnet-runbook.md)). Messages are funds-free (zero carrier, live); payments wait on a screened deposit or notes from inside the pool | **confirmed blocked on the operator** |

## How to run what exists

```shell
P=~/.cache/scarb/registry/git/checkouts/starknet-privacy-*/bc75e4b
pnpm -r test                                                     # unit, every package
RUN_POOL_E2E=1 STARKNET_PRIVACY=$P pnpm --filter @strk20-messaging/cli vitest run test/e2e-pool.test.ts
STARKNET_PRIVACY=$P pnpm --filter @strk20-messaging/web test:e2e
STARKNET_PRIVACY=$P pnpm run web:devnet   # then STARKNET_PRIVACY=$P pnpm run web, two browsers
```

## Priorities

1. **I1** — run it in a real browser once; everything else assumes this.
2. **D6** — back-to-back payments; a wrong surplus route would only show on the second one.
3. **D5/H2/H3/H5 in the web e2e** — port the CLI's envelope assertions so the browser path proves the same properties.
4. **F5** — the wrong-viewing-key negative test; the failure mode is silence.
5. **C7, E2, G3/G4** — the "someone paid me first", repeat-setup, and failure-path cases.
