# 21 — Mainnet deployment checklist

The helper contract (`MessageAnonymizer`, [contracts/src/message_anonymizer.cairo](../contracts/src/message_anonymizer.cairo))
must exist on mainnet, pinned to the mainnet STRK20 pool, before any mainnet message or
payment can be sent — and before the three transaction hashes the hackathon scores can exist.
This is the order of operations, with the values verified on 2026-09-07.

## Verified mainnet facts

| | Value | How verified |
| --- | --- | --- |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | Day 0 guide; `get_fee_amount` answers |
| Pool class | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` | `starknet_getClassHashAt` — **newer than Sepolia's** (`0x7e2bbd…`) |
| External invoke entry point | `privacy_invoke` (`0x402925cc…5043`) | `ExternalContractInvoked` events on the mainnet pool: 34 of the last 37 call this selector, on 16 different anonymizer contracts. **Our helper implements exactly this** |
| `InvokeExternalInput` | `{ contract_address, calldata: Span<felt252> }` | mainnet class ABI — same shape the SDK / wallet API assemble |
| Pool fee | **6 STRK per transaction** (Sepolia: 2) | `get_fee_amount` |
| RPC | `https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10` (spec 0.10.2) | probed; the Day 0 guide's lava endpoint is discontinued, Blast is dead |
| Chain id | `SN_MAIN` = `0x534e5f4d41494e` | |
| Explorer | `https://voyager.online/contract/…`, `/tx/…` | |
| Helper class hash (Sepolia) | `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612` | must be **declared on mainnet** first — a declare is part of the deploy |

**Done 2026-09-07:** the helper is live on mainnet at `0x030a2a39c47adba579c8fd07e7d9adbf5fe8f36b97da0b6ead884cae3a8bb3a6`
(declare `0x040534693d…`, deploy `0x07f38182c9…`, 4.9 STRK all-in) — [DEPLOYMENTS.md](../DEPLOYMENTS.md) § Mainnet.
Sections A–C below are complete; **D (the three transactions) and E are what remain.**

## Costs, budget before you start

| Item | Estimate | Note |
| --- | --- | --- |
| Declare + deploy helper | ~1–3 STRK | Sepolia deploy was 0.049 STRK; mainnet L2 gas ~28.7 gfri at check time, and a declare is bigger than a deploy |
| Each message / payment transaction | 6 STRK pool fee + ~2–3 STRK gas | measured ~2.5 STRK gas on Sepolia per send (docs/15 § B9) |
| Three scored transactions | **~25–30 STRK** all-in | plus whatever you shield to pay with |
| Shield (in Ready X) | the amount + pool fee + gas | registers the viewing key too |

Fund the deployer with ≥ 5 STRK and the Ready X account with ≥ 40 STRK to be safe.

## A. Before deploying

- [ ] **Toolchain**: `scarb 2.17.0`, `sncast 0.63.0` on PATH (`scarb --version`, `sncast --version`). Same versions the Sepolia class was built with — a different compiler gives a different class hash, which is fine but must be recorded.
- [ ] **Build clean**: `cd contracts && scarb build && scarb test` — all green.
- [ ] **Source frozen**: `git status` clean in `contracts/`; note the commit hash. The Sepolia helper is at commit `b39b66e`; deploy the same source unless a change was intended.
- [ ] **Mainnet deployer account** — `contracts/.env` (template `contracts/.env.example`, git-ignored, `chmod 600`):
  ```
  DEPLOYER_ADDRESS=0x…        # a funded mainnet account
  DEPLOYER_PRIVATE_KEY=0x…    # Ready X: Settings → account → Export private key
  ACCOUNT_TYPE=ready          # ready | braavos | oz  (sncast 0.63 names)
  ```
  The script imports it into sncast as `mainnet-deployer` (key handed over through a 0600 temp file, never on the command line) and checks the STRK balance. Alternatively `ACCOUNT=<existing sncast name>` skips `.env`.
  - **Never** reuse the Sepolia deployer key on mainnet; delete the key from `.env` after the deploy if the box is shared.
- [ ] **Balance check**: `sncast call --url <RPC> --contract-address 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d --function balanceOf --calldata <deployer>` ≥ 5 STRK.
- [ ] **RPC is mainnet**: the script checks `starknet_chainId == SN_MAIN` and refuses otherwise.
- [ ] **Pool is the real one**: the script calls `get_fee_amount` on it and refuses otherwise. Do not override `POOL_ADDRESS`.

## B. Deploy

```bash
ACCOUNT=mainnet-deployer ./contracts/deploy/mainnet.sh
```

The script: guards chain id and pool → asks you to type `mainnet` → `scarb build` → declare
(tolerates "already declared") → deploy with `pool = <mainnet pool>` → `pool()` sanity call →
Voyager verification → prints address, class hash, deploy tx.

- [ ] `pool()` echoes `0x040337b1…812a`. If it does not, **stop**: the constructor argument was wrong and the contract is useless (it is immutable — deploy again).
- [ ] Deploy transaction shows `ACCEPTED_ON_L2` on Voyager.
- [ ] Verification succeeded, or note that it needs manual submission on Voyager.

## C. After deploying — same commit

- [ ] **DEPLOYMENTS.md § Mainnet**: address, class hash, deploy tx + block + fee, constructor `pool`, source commit, date, deployer address. Mirror the Sepolia Phase-B table.
- [ ] **`apps/web/src/lib/presets.ts`**: `MAINNET_WALLET_PRESET.helperAddress = "<address>"`. Until then, wallet mode on mainnet opens Settings asking for it.
- [ ] **`apps/web/README.md`** and **`SUBMISSION.md`**: mainnet address and Voyager link.
- [ ] **`strk20.json`** at the repo root — create it now with the contract; hashes come in § D:

  ```json
  {
    "transactions": [],
    "contracts": ["<helper address>"],
    "demo_video": "",
    "demo_url": "https://venture23-aleo.github.io/veru-shield-connect/"
  }
  ```

- [ ] Commit, push, merge to `main` (the hub reads the default branch).

## D. The three mainnet transactions

Every scored hash must **exist, have succeeded, carry a STRK20 pool event, and — because
`contracts` lists the helper — carry an event from the helper** (the pool's
`ExternalContractInvoked` names it, and the helper's own `privacy_invoke` runs). Plain shields
and registrations do **not** qualify.

- [ ] Ready X on **mainnet**, a fresh account (never used with the app's pool mode or CLI), funded.
- [ ] Shield inside Ready X once (registers the viewing key); wait 10 blocks.
- [ ] Open the app → Connect Ready X wallet → probe says "STRK20 ready" → Settings shows the mainnet preset with the helper filled.
- [ ] Add a second registered account as a contact (a teammate's Ready X on mainnet). Payments need the recipient registered; messages carry a 1 wei note to the peer when registered.
- [ ] Send: (1) a message, (2) a payment with memo, (3) a message back or a request + payment. Each is one wallet prompt, 6 STRK fee + gas.
- [ ] Copy each tx hash from the outbox bar (Voyager link) into `strk20.json → transactions`. Check on Voyager that each shows the pool **and** the helper in its events.
- [ ] Wait for the hub to re-read (≤ 30 min) and confirm the three show as verified.

## E. Video and demo

- [ ] 3-minute demo video recorded on mainnet, link in `strk20.json → demo_video`.
- [ ] GitHub Pages enabled (Settings → Pages → Source: GitHub Actions) so the demo URL resolves; or set the repo's Website field.
- [ ] `LICENSE` file at the root (still missing — counts toward the open-source score).

## Rollback and gotchas

- The helper has no admin and no upgrade path; a wrong `pool` means a new deployment. Nothing is lost except gas — messages written to a wrong helper are unreadable by anyone.
- One helper serves everyone: the pool is the only caller (`CALLER_NOT_POOL`), storage is write-once per message id, so a second deployment does not conflict with the first.
- Mainnet fee is 6 STRK **per transaction**, not per message — batch several messages into one send where you can.
- Wallet-mode sends on mainnet go through Ready X's mainnet prover; expect 1–2 minutes per send. The app watches the helper's slots meanwhile and confirms as soon as the message lands.
