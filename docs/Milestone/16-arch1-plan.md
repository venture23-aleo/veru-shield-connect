# 16 — Arch 1 implementation plan: public sender, private recipient

**Decision (2026-09-07).** The product ships the **public-sender** shape: a payment and its
encrypted memo travel in one pool transaction, the payer is visible on-chain by design, and the
**recipient and the amount stay hidden**. Sender anonymity is dropped as a v1 goal.

This is not a new architecture. It is the [`pay`](../../apps/cli/src/commands.ts) path already in the
CLI, finished and made honest. The alternative considered — payer never touches the pool, funds
parked in the helper and claimed by the recipient — is deferred: it needs an
`OpenNoteScreeningPolicy` set by `only_app_governor` (`packages/privacy/src/privacy.cairo:1184`),
i.e. STRK20 governance must whitelist our contract, and open notes carry **plaintext** amounts
(`packages/privacy/src/utils.cairo:58`), which re-links the parties by amount.

## What the shape gives us

Verified against the pinned pool source (`starkware-libs/starknet-privacy` @ `bc75e4ba`):

| Element | Chain observer |
| --- | --- |
| Payer identity | **Visible** — by design; they are `sender_address` and pay the fee |
| Recipient identity | Hidden **from the second payment onward** — see the correction below |
| Amount | Hidden — encrypted notes pack an **encrypted** amount (`objects.cairo:95`, `utils.cairo:59`) |
| Memo content | Hidden — AEAD, as in every other mode |
| That a payment + memo happened | Visible — pool address, helper address, payload size, timestamp |

> **Correction, measured 2026-09-07.** The first draft of this table claimed the recipient is
> unconditionally hidden, reasoning that `CreateEncNote`'s recipient fields are client-action
> inputs carried in the proof. That is true, and it is not the whole story. The **first**
> payment to a new recipient also opens a channel, which compiles to an `Append` *server*
> action — and `AppendInput` names `recipient_addr` in the clear, because the pool has to know
> whose `EncChannelInfo` vector to append to (`packages/privacy/src/actions.cairo:372`). Server
> actions are public calldata.
>
> So payment #1 to Bob publishes "Alice opened a channel to Bob". Payment #2 onward publishes
> neither the payee nor the amount. Both halves are now asserted in
> [`e2e-pool.test.ts`](../../apps/cli/test/e2e-pool.test.ts) — the test opens the channel, asserts
> Bob IS in the calldata, then pays again and asserts he is not.
>
> Product consequence: **a first payment is never private as to who.** Channel setup should be
> separated in time from the payments that use it, which is the same advice STRK20 already
> gives for deposit/withdraw proximity ([02-threat-model.md](02-threat-model.md)).

Two consequences worth stating plainly in product copy: dropping sender anonymity **costs
nothing that the pool was giving us for free** (it removes the paymaster dependency), and it
makes the remaining claim — *who was paid, and how much, is private* — one we can actually
defend.

**No carrier note is needed on this path.** The transfer's own enc notes supply the `WriteOnce`
replay protection the pool demands (M0/S1); the 1-wei carrier hack applies only to message-only
transactions.

## Inventory — what exists today

| Piece | State |
| --- | --- |
| Helper contract | Done. [`message_anonymizer.cairo`](../../contracts/src/message_anonymizer.cairo), tested, deployed to Sepolia — but with `pool` = the deployer account (**dev mode**) |
| `pay` command | Wired ([`index.ts:157`](../../apps/cli/src/index.ts#L157)), direct-mode branch works |
| Pool transfer + invoke | [`pool.ts:64-68`](../../apps/cli/src/pool.ts#L64-L68) — **builder options are thinner than the shape proven to work** |
| Submission tail | [`tail.ts`](../../apps/cli/src/tail.ts) — `account.execute`, which is exactly right for a public sender |
| Channel discovery | [`channels.ts`](../../apps/cli/src/channels.ts) written but **never called from anywhere** |
| Pool-mode sync (recipient side) | Missing |
| e2e proof | [`e2e-pool.test.ts`](../../apps/cli/test/e2e-pool.test.ts) covers carrier + invoke, **not** transfer + invoke |
| Proving service URL | **External blocker** ([15 § B2](15-testnet-runbook.md)) — devnet mock proving is the substrate until it lands |

## Workstreams, in dependency order

### W1 — Redeploy the helper against the real pool  ☑ 2026-09-07 — `0x016f77a5…f6e0b6`, `pool()` verified ([DEPLOYMENTS.md](../../DEPLOYMENTS.md))

Unblocked today: the Sepolia pool address is known ([DEPLOYMENTS.md](../../DEPLOYMENTS.md)). The
constructor pins `pool` forever, so the Phase-A helper cannot be reused.

```shell
POOL_ADDRESS=0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91 \
  ACCOUNT=deployer ./contracts/deploy/sepolia.sh
```

Exit: `pool()` echoes the pool address; the new address is recorded in `DEPLOYMENTS.md` in the
same commit. Direct mode dies with this deployment — it is a dev-only mode and should be marked
as such in the CLI, not silently broken.

### W2 — Make the transfer branch match the shape that actually works  ☑

The memo branch of `poolSend` builds with `{ autoSetup: true }` only. The transfer proven to
execute against the real pool ([`e2e-pool.test.ts:101-110`](../../apps/cli/test/e2e-pool.test.ts#L101-L110))
also passes `autoSelectNotes: "all"`, `autoDiscover`, and — critically — **`surplusTo`**. Without
surplus routing the balance invariant ("every touched token nets to zero",
[M0 § S1](14-m0-decision-record.md)) has no change note to absorb the remainder.

- Add `autoSelectNotes` / `autoDiscover` / `surplusTo(account.address)` to the `opts.transfer`
  branch of [`pool.ts:64-68`](../../apps/cli/src/pool.ts#L64-L68).
- Add `autoRegister: true` so a first-time payer's `SetViewingKey` rides the first payment.
- Collapse the two `createPrivateTransfers` call sites into one factory — `pool.ts` passes
  `account`, `channels.ts` passes `viewingKeyProvider`, and nothing guarantees they agree.

**Found while doing it:** the options were the smaller half of the problem. Both call sites
invoked `createPrivateTransfers` with parameters the SDK does not have — `poolAddress` for
`poolContractAddress`, a bare `provingUrl` for `provingProvider`, and the send path passed **no
`viewingKeyProvider` at all**, which is required (`sdk/src/factory.ts:43-49`). Neither would
have constructed. Nothing caught it because the only e2e builds `transfers` from the SDK's own
devnet harness and never touches our factory. The factory now lives once, in
[`poolClient.ts`](../../apps/cli/src/poolClient.ts).

Exit: W6's transfer + invoke e2e passes on devnet. **It does.**

### W3 — Viewing key: one source of truth  ☑

`CliConfig` has no viewing-key field at all, yet `discoverChannelsFromPool` requires one. Add it,
enforce **`bigint` at the boundary** (the hex-string footgun from [M0 § S4](14-m0-decision-record.md)
— a wrong type yields a silent empty scan that reads to the user as "my money is gone"), and keep
it out of the config file the way the private key already is.

Also fix the type gap: `channels.ts` reads `discoveryUrl` and `ohttp` through casts because
[`config.ts`](../../apps/cli/src/config.ts) does not declare them.

### W4 — Wire channel discovery  ☑

The dead `discoverChannelsFromPool` is the recipient's only route to a channel key: per
[M0 § S4](14-m0-decision-record.md) only the *sender* can derive it — the recipient must decrypt
it during the pool's channel scan. Until this is called, **B cannot read anything in pool mode.**

- Call it from `sync` (and expose `msg channel discover`), merging results into `config.channels`.
- Keep OHTTP on by default; the existing loud warning on opt-out stays.

### W5 — Recipient-side sync in pool mode  ☑

With channel keys arriving from W4, the existing dense-index walk over helper storage is
unchanged — it is the same [`walk.ts`](../../apps/cli/src/walk.ts) scan. What is new is pairing each
decrypted memo with the payment it rode with, so `history` shows
"25 of 0x04718f5a… · *invoice 4412*" rather than a bare memo.

**The pairing cannot come from chain state.** The note's amount is encrypted and its owner
lives in the proof, so the recipient has nothing to join on. The sender does — they know both —
so `pay` writes the token and amount **inside the sealed body**
([`payment.ts`](../../sdk/src/payment.ts)): a 52-byte `PAY1` header ahead of the memo text,
private and authenticated by the same MAC as the sender. A body without the magic is an
ordinary message, so this is purely additive: the frame layout and the frozen vectors are
untouched.

### W6 — Test the actual Arch 1 shape  ☑

`e2e-pool.test.ts` proves carrier + invoke. Add a sibling case: **transfer + invoke**, one
transaction, asserting

- the transfer lands as an enc note B can discover and spend,
- the memo decrypts under the discovered channel key,
- the payer **is** `sender_address` (the inverse of the existing anonymity assertion — this is now
  a deliberate property, so assert it rather than leaving it implied),
- the payee and the amount are absent from the envelope (with the channel-open exception
  above, which the test pins deliberately).

**Running it.** The gate is unchanged (`RUN_POOL_E2E=1 STARKNET_PRIVACY=<checkout>`), and the
checkout can be the one Scarb already vendors, which avoids a second clone:

```shell
P=~/.cache/scarb/registry/git/checkouts/starknet-privacy-*/bc75e4b
(cd $P/sdk && npm ci && npm run build)   # TS SDK + testing harness
(cd $P && scarb build)                   # pool artifacts the devnet harness deploys
(cd contracts && scarb build)            # our helper
RUN_POOL_E2E=1 STARKNET_PRIVACY=$P pnpm --filter @strk20-messaging/cli vitest run test/e2e-pool.test.ts
```

### W7 — Docs and honesty pass  ☑

- [02-threat-model.md](02-threat-model.md): flip the "sender identity — hidden" row, and add the
  **proving service** as an actor. It sees the witness: sender, recipient, token, amount. It is
  currently not listed at all, and on this path it is the strongest adversary.
- [05-contracts.md](05-contracts.md): the "Pool integration" section reads as though live
  integration exists; scope it to what is checked.
- [01-overview.md](01-overview.md) / README: drop sender anonymity from the pitch.

### W8 — Web app  ☑ 2026-09-07 — pool mode in the browser, proven on devnet

[`poolBackend.ts`](../../apps/web/src/lib/poolBackend.ts) ports the CLI's shapes onto the web
`Backend`: carrier + invoke for messages, transfer + invoke for **pay**, submitted from the
user's own account. The Privacy SDK comes from a built checkout via `STARKNET_PRIVACY`
([`vite.config.ts`](../../apps/web/vite.config.ts) — exact-match aliases; a stub otherwise, so
builds never depend on it). [`test/pool.e2e.test.ts`](../../apps/web/test/pool.e2e.test.ts)
drives two backends against the real pool contract: alice pays bob with a memo, bob discovers
the lane and reads a payment; bob's message-only send opens a channel alice discovers.
[`scripts/pool-devnet.mjs`](../../scripts/pool-devnet.mjs) gives the same environment to a
browser in one command ([apps/web/README.md](../../apps/web/README.md) § Pool mode).

Two things learned that changed the design, both now in the code and the threat model:

- **Only the sender can derive a channel key; the recipient's route is discovery — and
  `discoverChannels` returns outgoing channels only.** Incoming keys come from the notes
  scan's cursor (`incomingChannels`, keyed by sender), which decrypts every channel info filed
  under your address whether or not a note exists. The CLI's discovery had the same wrong
  assumption and is fixed the same way. The sender-side derivation
  ([`hashes.js`](../../apps/web/src/lib/privacySdk.ts)) was proven equal to the channel the SDK
  opens — the e2e asserts bob discovers exactly the key alice derived.
- **A first message must open the channel** (`builder.setup(peer)`) or the recipient can
  never find the lane; a payment does it through `autoSetup`. Contacts track `setupDone`.

Still true: a live browser send waits on the proving endpoint (B2) exactly as the CLI does.

## Critical path

W1 → W2 → W6 can all be done now, on devnet, with no external dependency. W4/W5 are the
recipient half and are independent of the proving URL. **Only the live Sepolia run is blocked on
[B2](15-testnet-runbook.md).** The milestone "Arch 1 proven end-to-end on devnet against the
real pool contract" is reached for the CLI **and** the browser (W6, W8); the Sepolia helper is
deployed (W1). The Sepolia send itself is the follow-on when the endpoint lands.

## Risks

- **Amount privacy is only as good as the note set.** Encrypted amounts hide the value, but a
  payer with one note of exactly the right size still narrows things; `autoSelectNotes` behaviour
  is worth reading before claiming otherwise.
- **Unregistered recipient** is a compose-time failure, not a submit-time one — check it when the
  contact is added, as the web client already does.
- **Public payer means public timing.** A payer who sends to one counterparty at a fixed cadence
  leaks the relationship even with the recipient hidden. Client-side jitter helps; say so rather
  than implying the recipient is unconditionally private.
