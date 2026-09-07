# Deployments

Single source of truth for every on-chain address this project uses. Update this file in the
same commit as any deployment. Explorer: prefix addresses/txs with `https://sepolia.voyager.online/contract/` or `/tx/`.

## Sepolia

### MessageAnonymizer — Phase B (pool mode, **current**)

| | |
| --- | --- |
| **Address** | `0x016f77a566ed28f2945e315f2de971b8f3e83a03b93340e8927a311277f6e0b6` |
| Class hash | `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612` (identical to Phase A — same source, already declared) |
| Deploy tx | `0x0425af6dad2ce028c83918ce64feee9d0351f4cd8a83325a6b934eaf19e6537e` — block 14,680,164, fee 0.049 STRK |
| Constructor `pool` | `0x254a6b29…e0d91` — **the real STRK20 Sepolia pool**; `pool()` verified to echo it after deploy |
| Source | `contracts/src/message_anonymizer.cairo` @ class above (unchanged since `b39b66e`) |
| Deployed | 2026-09-07 |
| Mode | Pool mode only. Writes come from the pool via `InvokeExternal`; nothing else can call `privacy_invoke` (`CALLER_NOT_POOL`). First live send still waits on the proving endpoint ([docs/15 § B2](docs/Milestone/15-testnet-runbook.md)). |

### MessageAnonymizer — Phase A (direct/dev mode, superseded)

| | |
| --- | --- |
| **Address** | `0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032` |
| Class hash | `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612` |
| Deploy tx | `0x06b8a04196f3538b6ce5c89003ff4f921f9909e48c545ba23769588f4e4a88fe` |
| Constructor `pool` | `0x03ab7fda…afac4` (the deployer account — **direct/dev mode only**) |
| Source | `contracts/src/message_anonymizer.cairo` @ commit `b39b66e` |
| Deployed | 2026-09-04 |
| ⚠ | Dev only: its `pool` is the deployer account, so only that account can write. Kept for `mode: "direct"` development; **not** the address pool mode uses — see Phase B above. |

### Registered on the pool

| Account | Tx | Note |
| --- | --- | --- |
| deployer `0x03ab7fda…afac4` | [`0x7c0196fc…5700e`](https://sepolia.voyager.online/tx/0x7c0196fcc4b793c9f8e797370fef1ae7b9b13d0db35d047f053d93ed4d5700e) | 2026-09-07 · `SetViewingKey`, proved by our own prover, submitted via StarkWare's gateway. Public key `0x105646f0…cbf5`. Viewing key: `~/.strk20-msg/sepolia-viewing-key` on the dev box (0600). |

### Deployer account

| | |
| --- | --- |
| **Address** | `0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4` |
| Type | OpenZeppelin account (sncast name: `deployer`; key in `~/.starknet_accounts/starknet_open_zeppelin_accounts.json` — testnet only, never reuse for value) |
| Deploy tx | `0x0482173cabf4cb0586dae3046112072a8b5f652176430070094a600f2ad04971` |
| Funded | 100 STRK via faucet, 2026-09-04 |

### External (not ours)

| Contract | Address | Note |
| --- | --- | --- |
| **STRK20 pool** | `0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` | **Full address recovered 2026-09-05** by scanning Sepolia for the pool's `ViewingKeySet` events; active. Class `0x7e2bbd7ccc1e68b2695caef70aeb2a3be6cd017b5d5159278ba08f2d8de33f` (differs from mainnet's — older deployment) |
| STRK fee token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | |
| ETH token | `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7` | |

### RPC endpoints

| Endpoint | Status |
| --- | --- |
| `https://api.cartridge.gg/x/starknet/sepolia` | **in use** (spec 0.9; sncast warns, works) |
| `https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10` | spec 0.10.2, `starknet_getStorageProof` works — **what the transaction prover needs** |
| `https://starknet-sepolia.drpc.org` | fallback — flaky (`getBlockWithTxHashes` intermittently missing) |
| `*.blastapi.io` | dead — do not use |

## Mainnet

### MessageAnonymizer — pool mode (**current**)

| | |
| --- | --- |
| **Address** | [`0x030a2a39c47adba579c8fd07e7d9adbf5fe8f36b97da0b6ead884cae3a8bb3a6`](https://voyager.online/contract/0x030a2a39c47adba579c8fd07e7d9adbf5fe8f36b97da0b6ead884cae3a8bb3a6) |
| Class hash | `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612` (same source and compiler as Sepolia Phase B → same class) |
| Declare tx | [`0x040534693d8cbb2f9d871d5f3195fcdbaa51892c01ebc49e68900d485c69b6f7`](https://voyager.online/tx/0x040534693d8cbb2f9d871d5f3195fcdbaa51892c01ebc49e68900d485c69b6f7) — block 14,519,043, fee 4.85 STRK |
| Deploy tx | [`0x07f38182c93bd902e8d3830b86a4f1acc0be90f629ba396e7ea3a513ae9fb8e8`](https://voyager.online/tx/0x07f38182c93bd902e8d3830b86a4f1acc0be90f629ba396e7ea3a513ae9fb8e8) — block 14,519,072, fee 0.052 STRK |
| Constructor `pool` | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` — **the mainnet STRK20 pool**; `pool()` verified to echo it after deploy |
| Source | `contracts/src/message_anonymizer.cairo` (unchanged since `b39b66e`) |
| Deployed | 2026-09-07, via `contracts/deploy/mainnet.sh` |
| Deployer | `0x0227a359dd6dcdb1fb9e0d42c21118b0d54a332083fc419cd67ed042ea284729` (Ready X account; key in `contracts/.env`, git-ignored) |
| Verification | Submitted to Voyager 2026-09-07 (job `381255ba-a382-4afe-a4e5-f9cb19305241`, status at submission: 5); MIT license in `Scarb.toml` and `LICENSE.md` at the repo root |
| Mode | Pool mode only: the pool calls `privacy_invoke` through `InvokeExternal` (`CALLER_NOT_POOL` otherwise). The mainnet pool's class (`0x67dddd…554d`) was checked to call exactly this selector before deploying ([docs/21](docs/Milestone/21-mainnet-deployment-checklist.md)). |

### External (not ours)

| Contract | Address | Note |
| --- | --- | --- |
| **STRK20 pool** | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | class `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`; fee **6 STRK** per transaction (`get_fee_amount`) |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | fee token, same address as Sepolia |
| RPC | `https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10` | spec 0.10.2 — what starknet.js 10.5 accepts |

Explorer: `https://voyager.online/contract/…`, `/tx/…`.
