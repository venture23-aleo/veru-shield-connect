# 15 — Testnet Runbook

How to take everything built in M0–M6 onto **Sepolia**. Two phases: Phase A is a
direct-mode run achievable today with nothing but faucet funds; Phase B is the real
pool-mode path, blocked on information only the STRK20 side can provide.

Status legend: ☐ open · ☑ done. Update this file as items close.

---

## Phase A — direct (dev) mode on Sepolia

The M3 devnet scenario on a public network: real chain, real contract, real messages.
**The submitter is visible** — direct mode has no pool anonymity; it exists to prove the
pipeline and to measure real costs.

### A1 ☑ Create or pick a Sepolia account

> Done 2026-09-04: sncast account `deployer` created at
> `0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4`
> (est. deployment fee 0.0829 STRK). Network deploy pending faucet funds (A2).

Either export from a wallet (Argent / Braavos → address + private key), or:

```shell
sncast account create --name deployer --network sepolia
```

A fresh account must also be **deployed** — `sncast account deploy` after funding, or a
wallet's first transaction does it.

### A2 ☑ Fund it with Sepolia STRK

> Done 2026-09-04: faucet delivered 100 STRK; account deployed —
> tx `0x0482173cabf4cb0586dae3046112072a8b5f652176430070094a600f2ad04971`.

- https://faucet.starknet.io (or the Alchemy faucet)
- 1–2 STRK is plenty; fees per message are fractions of a cent.

### A3 ☑ Pick an RPC endpoint

- **In use:** `https://api.cartridge.gg/x/starknet/sepolia` (spec 0.9.0; sncast 0.63 warns
  it wants 0.10 but works)
- `https://starknet-sepolia.drpc.org` worked early on, then began refusing
  `starknet_getBlockWithTxHashes` mid-session — its load balancer is inconsistent; keep as
  fallback only
- More reliable for sustained use: a free keyed endpoint (e.g. Alchemy)
- **Dead — do not use:** BlastAPI (`*.blastapi.io` returns a shutdown notice)

### A4 ☐ Deploy the helper (pool = your own account)

For direct mode, the constructor's `pool` is **your account address** — the same trick the
devnet e2e uses, so `privacy_invoke` accepts your direct calls:

```shell
POOL_ADDRESS=<your account address> \
ACCOUNT=deployer \
./contracts/deploy/sepolia.sh
```

The script declares, deploys, sanity-checks `pool()`, and attempts Voyager verification.

> ☑ Done 2026-09-04. class hash
> `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612`, helper deployed at
> **`0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032`**
> (tx `0x06b8a04196f3538b6ce5c89003ff4f921f9909e48c545ba23769588f4e4a88fe`);
> `pool()` echoes the deployer address.

### A5 ☑ Configure the CLI and run the M3 transcript

> Done 2026-09-04, on Sepolia: machine A `send --to bob "hello from Sepolia"` →
> confirmed `0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395`;
> machine B (fresh home, channel key only) `read` →
> `[1] from 0x3ab7… · 21 s ago · "hello from Sepolia"`, and
> `sync --full` reconstructed it: `synced to block 14,544,448 · 1 message(s) known`.

```shell
export STRK20_MSG_PRIVATE_KEY=<key>          # never in config files or the repo

msg init --rpc https://starknet-sepolia.drpc.org \
         --helper <helper addr> --account <your addr> --mode direct
msg channel add --label bob --peer <peer addr> --key <shared channel key hex>

# machine A
msg send --to bob "hello"          # → submitted 0x… → confirmed 0x…

# machine B (second config home or a genuinely different machine;
# needs only the RPC URL, helper address and the channel key)
msg read                           # → [1] from 0xALICE · 2 min ago · "hello"
msg sync --full && msg history     # M5: full reconstruction from chain state
```

Batching and memo work identically: `msg queue` ×N + `msg flush`, `msg pay`.

### A6 ☑ Bank the real cost numbers (closes M0/S3's residual)

The M0 decision record priced storage from a **model**; the send receipts now give the
real figure. For one 256 B-tier and one 4 KiB-tier message (`--pad 4096`), pull the
receipt and record actual fee + gas split:

```shell
curl -s <rpc> -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,
  "method":"starknet_getTransactionReceipt","params":["<tx hash>"]}'
```

Write the numbers into [14-m0-decision-record.md](14-m0-decision-record.md) § S3.

| Tier | tx hash | actual fee (STRK) | l1_data_gas | l2_gas |
| --- | --- | --- | --- | --- |
| 256 B | `0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395` | **0.2076** | 1,152 | 6,032,160 |
| 4 KiB | `0x32a7b35d2ebe87d12cb7c53110963e6c9cb89f3e5ae100f91b52292969afe91` | **2.3185** | 13,056 | 67,595,040 |

> Measured 2026-09-04, Sepolia gas prices, direct mode (no pool wrapper, no proving fee).
> **The M0 model's conclusion was right but its emphasis was wrong**: DA is indeed
> negligible, but **L2 execution gas dominates** — ~93% of the fee is the per-felt storage
> writes, scaling linearly with payload felts (4 KiB ≈ 11× the 256 B fee). At $0.027/STRK:
> ~$0.006 per 256 B message, ~$0.063 per 4 KiB message, before pool/proving overhead.
> Written back into [14-m0-decision-record.md](14-m0-decision-record.md) § S3.

---

## Phase B — pool mode (the real anonymous path)

### B1 ☑ Obtain the full Sepolia pool address

> **Closed 2026-09-05.** Recovered without any external party:
> `pool = 0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`
> Method: pulled the full **mainnet** address from AVNU's production frontend bundle,
> took its class hash, confirmed the pool class is declared on Sepolia, then scanned
> Sepolia for the pool's `ViewingKeySet` events — one emitter, matching the truncated
> form. The pool is active. (Sepolia runs an older pool class than mainnet —
> re-verify SDK compatibility at first contact.)

### B2 ☑ Proving — **self-hosted**, no operator endpoint needed

> **Unblocked 2026-09-07.** The pool README's compatibility matrix names a published
> **transaction prover** container (`ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2`,
> docs in the sequencer repo). It needs an RPC node speaking spec **v0.10** with storage proofs —
> Cartridge's `…/sepolia/rpc/v0_10` has both, so no Pathfinder sync. Run:
>
> ```shell
> sudo docker run -d --name strk20-prover -p 3000:3000 \
>   -e RPC_URL=https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10 -e CHAIN_ID=SN_SEPOLIA \
>   -e MAX_CONCURRENT_REQUESTS=2 -e PREFETCH_STATE=true -e CORS_ALLOW_ORIGIN=http://localhost:5173 \
>   ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2
> ```
>
> Dry run (`scripts/sepolia-prove-register.mjs`, prove only): a registration for the deployer
> proved in **8.2 s** (5.1 s Stwo proving) at block 14,682,484 — 9 proof facts, 304 KB proof,
> call → pool `apply_actions`. Machine: 48 cores / 251 GB (the README recommends 48 vCPU / 96 GB).
> The prover **sees the witness**, exactly as the threat model says — here it is ours.
> OHTTP must be off toward it (no gateway); the clients default to that for localhost.
>
> Open: whether the RC.2 prover's proof is **accepted on-chain** by the Sepolia pool (class
> `0x7e2bbd…`, older than mainnet's) — that is the `--submit` step, B8.
>
> **Found on the way (2026-09-07): fee estimation cannot be used for proof-carrying
> transactions.** `starknet_estimateFee` is a simulation in which the OS never verifies the
> proof, so the pool's syscall sees no facts and reverts with `EMPTY_PROOF_FACTS` — on both
> the 0.9 and v0.10 Cartridge endpoints. starknet.js's `execute()` estimates unless it is
> given `resourceBounds`; the SDK's own reference client never estimates (its
> `estimateInvokeFee` is `Promise<never>`) and submits via a paymaster. Both our clients and
> the script now submit with explicit bounds from the latest block's prices (×1.5, generous
> amounts). Devnet never showed this because its estimation carries the facts through.

The previous text, kept for the record:

Remote proving is mandatory (`ProvingServiceProofProvider`); there is no local prover.
Searched 2026-09-05: no public endpoint exists in the `starknet-privacy` repo, AVNU's
frontend bundle, or reachable docs — AVNU appears to proxy proving through its own
backend. Source: the STRK20 team directly. Note: **a hosted prover sees the witness** —
fine for testnet, a real decision for production.

Also blocked behind this: registration itself. The pool is an account contract
(`__execute__`/`__validate__`) — `SetViewingKey` rides *inside* proven transactions, so
there is no proof-free on-ramp.

### B3 ◐ Discovery — self-hostable, no external URL needed

Two findings (2026-09-05): `ContractDiscoveryProvider` (plain-RPC discovery, no indexer)
**exists in the SDK's testing surface** and is what the harness uses — worth requesting
as a public export. And the indexer itself is open source and self-hostable
(`deploy/discovery-service/` in the pool repo, Rust, needs only an RPC URL). Either path
avoids depending on a hosted indexer. OHTTP stays the default if a hosted one is used.

### B-proof ☑ Pool-mode mechanics proven against the real pool contract

> **2026-09-05** — `apps/cli/test/e2e-pool.test.ts` (gated `RUN_POOL_E2E=1` +
> `STARKNET_PRIVACY=<built clone>`): our helper deployed with **pool = the real pool
> contract**; alice registers + shields; the message rides a pool transaction built by
> the `pool.ts` shapes; the **pool calls `privacy_invoke`** (the helper's
> `CALLER_NOT_POOL` guard proves the caller); submission via **outside execution** —
> asserted: the sender's address appears **nowhere in the transaction envelope**, not
> as `sender_address`, not in calldata; the recipient decrypts normally. Sender
> anonymity is functional; Sepolia needs only the B2 endpoint swapped in.
>
> Execution finding on the carrier: the pool sanctions zero-amount enc notes (M0/S1)
> but the shipped SDK rejects them client-side ("Created note amount must be
> positive") — the working carrier is a **1-wei enc-note self-transfer** (private
> churn, nothing leaves the pool). Pinned in the test; revisit on SDK updates.
>
> **2026-09-07 — Arch 1 shape proven on the same harness** ([16](16-arch1-plan.md)): a real
> transfer to bob + memo in one transaction, submitted through the CLI's own `submitPool`
> tail from alice's account (not outside execution). Asserted: the memo decrypts as a
> payment, bob's note carries the amount, **alice is `sender_address`**, and — from the
> *second* payment on — bob's address and the amount appear nowhere in calldata. The
> *first* payment names bob in the clear: opening the channel is a public `Append`
> (`actions.cairo:329-334`); the test pins both halves. No carrier note on this path —
> the transfer's enc notes are the replay protection.

### B4 ☐ Register viewing keys — both parties

`SetViewingKey` on the pool for sender **and** recipient (unregistered recipients cannot
receive — the app's compose-time stop is not theoretical). The SDK's `autoRegister: true`
bundles registration into the first real operation.

### B5 ☐ Shield tokens and pick the carrier token

At least one deposit into the pool per account, and set `config.pool.carrierToken` (the
zero-amount carrier note's token — the deposited token is the natural choice).

### B6 ☑ Redeploy the helper with the real pool address

> **Done 2026-09-07.** `0x016f77a566ed28f2945e315f2de971b8f3e83a03b93340e8927a311277f6e0b6`,
> tx `0x0425af6d…6537e`, block 14,680,164, 0.049 STRK. `pool()` echoes the real pool.
> Two bugs in `deploy/sepolia.sh` fixed on the way: the already-declared path aborted under
> `set -e` before its fallback ran, and the address parser expected snake_case where sncast
> 0.63 prints `Contract Address:`. Voyager verification: see below.

The constructor pins `pool` **forever** — the Phase-A helper cannot be reused:

```shell
POOL_ADDRESS=<full pool address> ACCOUNT=deployer ./contracts/deploy/sepolia.sh
```

### B7 ☐ Build the Privacy SDK locally and point the CLI at it

```shell
git clone https://github.com/starkware-libs/starknet-privacy   # public, no auth
cd starknet-privacy/sdk && npm ci && npm run build             # Node 22+ works
```

Then `msg init --mode pool` and fill `config.pool`:
`{ sdkPath, poolAddress, provingUrl, discoveryUrl, carrierToken }`.

### B7½ ☑ First live transaction: registration accepted by the Sepolia pool

> **2026-09-07** — [`0x7c0196fc…5700e`](https://sepolia.voyager.online/tx/0x7c0196fcc4b793c9f8e797370fef1ae7b9b13d0db35d047f053d93ed4d5700e):
> the deployer's `SetViewingKey`, proved by **our** transaction prover (5.5 s) and verified by
> StarkWare's Sepolia gateway. `get_public_key` now returns `0x105646…`. **The RC.2 prover's
> proofs are accepted by the live pool** — the last version question, closed.
>
> What it took, because every client will hit it: **the RPC's write path cannot carry
> proof-carrying transactions.** Cartridge's `addInvokeTransaction` (0.9 and v0.10 alike) died
> with `Account: invalid signature`; replaying a *mined* pool transaction through its
> `simulateTransactions` showed its node expects proof-facts version `PROOF0` while the chain
> (and our prover) is on `PROOF1` — a node one protocol version behind, mangling the fields.
> The hash itself is right: starknet.js 10.5's v3 hash with `poseidon(proof_facts)` appended
> reproduces the mined transaction's hash exactly. Submitting the *same* signed transaction
> to `https://alpha-sepolia.starknet.io/gateway/add_transaction` (which parses the fields and
> verifies the proof itself) was accepted first time. Both clients now submit there
> ([`gateway.ts`](../apps/cli/src/gateway.ts)); the gateway answers no CORS preflight, so the
> browser goes through the dev server's `/gateway` proxy. Devnet keeps the RPC path.
>
> Two more gateway rules met on the way: `proof_facts` and `proof` must travel together
> (`PROOF_FACTS_AND_PROOF_CONSISTENCY`); and the account balance must cover
> `max_amount × max_price_per_unit` for **every** resource bound (`VALIDATE_FAILURE …
> exceed balance`) — a lazy `l1_gas` ceiling alone demanded 24 STRK for a resource an L2-only
> transaction never uses. Bounds are now calibrated on the mined registration (0 / 79.8 M /
> 704 gas, 2.27 STRK): `l1_gas` 0, `l2_gas` 250 M, `l1_data_gas` 20 000 — ≈10.7 STRK ceiling.

### B8 ☑ First live messages through the Sepolia pool

> **2026-09-07** — from the CLI (`msg send --to safari …`, deployer → safari), the real thing:
> [`0x76a93b3b…9a72`](https://sepolia.voyager.online/tx/0x76a93b3b8eeab032562fd56844deefa86a34f135295a8b57c90444668bb9a72)
> (index 0; 2.52 STRK; 0 / 88.5 M / 2 368 gas) and
> [`0x67824552…8687`](https://sepolia.voyager.online/tx/0x67824552e8c160c1765bc7e618fbb5487a83a354a8c5ae452577eebf1888687)
> (index 1, which also opened the channel deployer → safari — safari's `get_num_of_channels`
> went 1 → 2). Each carried the **zero-amount carrier note**: no funds in the pool, no
> screened deposit — the pool-sanctioned carrier the docs argued for, now proven live. The
> helper's `slot_len(msgId(lane, 0))` reads 9 felts: the pool called `privacy_invoke` on
> Sepolia. Payments still need notes → a screened deposit (operator); messages do not.
>
> Bug found by the first of the two: the CLI send path never called `setup(peer)`, so the
> message was stored but the recipient could not have discovered the lane (only the notes
> scan hands out incoming keys, and only for opened channels). Fixed like the web store:
> first send to a peer adds `setup(peer)`; `ChannelConfig.setupDone` remembers it.
>
> Second bug, found by the browsers: a client that had never *itself* sent to a peer added
> `setup(peer)` although another client had already opened the channel — the pool's channel
> marker is write-once, the transaction reverted in proving, and the outbox quietly re-queued
> the messages. Both clients now address the zero-amount carrier **to the peer** (self only
> for group lanes): `autoSetup` opens the channel exactly when it is missing. Verified live
> ([`0x7a43b60e…2c22`](https://sepolia.voyager.online/tx/0x7a43b60e20316dbd1b5d1a4d89a26aa58b098c523f55f5bb2e86e87bcc62c22),
> third message, channel count unchanged). The outbox bar now shows the failure reason while
> messages are still queued.
>
> Superseded text kept below for the carrier-step history.

### B9 ☑ The full loop, live, browser to browser

> **2026-09-07** — safari's window (Safari, on the user's laptop) registered through the UI
> ([`0x25633cd4…`](https://sepolia.voyager.online/tx/0x25633cd47bf4) and following, sender
> safari), then sent three messages through the Sepolia pool; the deployer side discovered
> the incoming channel and read all three (`msg channel discover` → `msg sync` → `history`:
> "hi ", "wasp?", "what he heck"), alongside its own two. Proved by our prover, submitted
> through the gateway, stored by the pool's call to the helper, discovered over plain RPC
> from the pool contract, decrypted locally. Sender anonymity is not claimed (Arch 1); the
> content, the lanes and — on every message after the channel-open — the counterparty are
> absent from the envelope. Cost: ~2.5 STRK gas + 2 STRK pool fee per message, no funds in
> the pool.
>
> Observer check (the original B9): open any of the message transactions on Voyager — the
> sender account, the pool, and the helper are visible; the recipient (after the first
> message) and the content are not.

### B10 ✗ Shielding on Sepolia is closed to us — proven, not assumed

> **2026-09-07** — a 1 STRK deposit from the deployer (`scripts/sepolia-prove-register.mjs
> --deposit=1000000000000000000 --submit-gateway`): proved in 6.5 s, accepted by the gateway,
> **reverted in the pool with `SCREENING_REQUIRED`**
> ([`0x71c94245…9c95`](https://sepolia.voyager.online/tx/0x71c942458078012aa779e009aceb6a4b8fef1c89965de8e68e1a3e187569c95)).
> A regular deposit (`TransferFrom`) always demands a screening attestation for the depositor,
> signed by the pool's screener key (`0x62f1e7ca…`, operator-held) — no policy switch
> applies to it (policies govern only anonymizer open-note deposits). So on Sepolia:
> **messages: unlimited, no funds needed · payments: impossible until notes reach us.**
>
> Ways in, all through someone else: (1) the STRK20 team screens a deposit for our
> address (their proof-interceptor issues the attestation; it binds `{depositor, issued_at}`
> and is reusable within its freshness window); (2) governance sets our helper's open-note
> policy to `Exempt`/`Delegated`, making the helper a deposit path (Arch 2's dependency,
> [16](16-arch1-plan.md)); (3) an account already inside the pool sends us notes — internal
> transfers are not screened. If AVNU's front end serves Sepolia, shielding there and
> privately transferring to a registered address of ours is route (3).

### B8′ ☐ (historical) First live pool send — watch the carrier step

> **Sequence, now that proving is local:** (1) `--submit` the registration — permanent: it
> binds the viewing key in `~/.strk20-msg/sepolia-viewing-key` to the account. (2) Funds:
> deposits need a **screening attestation** signed by the pool's screener key
> (`get_screener_public_key` = `0x62f1e7ca…`, operator-held) — we cannot shield ourselves.
> Routes: an internal transfer from someone already inside the pool (no screening), or the
> operator's screening service. (3) **Message-only sends need no funds at all**: the
> pool-sanctioned **zero-amount** carrier (M0 § S1) is now what both clients use —
> `scripts/patch-privacy-sdk.mjs` (`pnpm run sdk:patch`) applies two one-line patches to the
> vendored SDK: allow creating a zero note, and never auto-*select* one as an input (the pool
> rejects `UseNote` on it — this failed the payment that followed a message, caught by the CLI
> e2e). Proven 2026-09-07 against the real pool contract on devnet: message with zero carrier,
> then a payment. Re-run the script after any Scarb re-fetch of the checkout.
> (4) The pool's 2 STRK fee is pulled by `TransferFrom`: both clients approve the pool
> automatically (for fifty transactions) when the allowance is short — its own transaction,
> since the proof is bound to the exact pool call.

The first live send doubles as the last unverified M0 claim's on-chain test: the carrier
(`transfer(self, 0n)` compiling to the pool-sanctioned zero-amount `CreateEncNote`) is
verified in pool source but has never run on-chain. If it is rejected, the fallback is a
dust self-transfer — a one-line change in `apps/cli/src/pool.ts`, plus a cost/threat-model
note. Also empirically find the real batch-size ceiling (M4's known unknown): flush 8,
then larger, until the prover pushes back — the halving fallback handles the failure.

### B9 ☐ Verify the observer property — the full M3 exit criterion

Open the confirmed transaction on an explorer (e.g. sepolia.voyager.online). An observer
must see: the pool and helper addresses, a payload size, a timestamp — and **neither
party's address, no recipient, no content**. Screenshot it for the record.

### B10 ☐ Optional: paymaster

AVNU API key (held server-side) decouples the submitting address — the D3′ v1
recommendation. Direct submission stays available as the liveness fallback.

---

## Quick reference

> Canonical address registry: [DEPLOYMENTS.md](../DEPLOYMENTS.md) — update it in the same
> commit as any deployment. The table below is a convenience snapshot.

| Item | Value |
| --- | --- |
| RPC (Sepolia) | `https://api.cartridge.gg/x/starknet/sepolia` (drpc = flaky fallback) |
| Toolchain | scarb 2.17.0 · snforge/sncast 0.63.0 · matches `starknet-privacy@bc75e4ba` |
| Deployer account | `0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4` (sncast name: `deployer`) |
| Class hash | `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612` |
| Helper (Phase A) | `0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032` (pool = deployer, dev only) |
| Pool (full address) | `0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Helper (Phase B) | `0x016f77a566ed28f2945e315f2de971b8f3e83a03b93340e8927a311277f6e0b6` (pool = real pool, **current**) |
| Private key handling | `STRK20_MSG_PRIVATE_KEY` env only — never in config files or the repo |
