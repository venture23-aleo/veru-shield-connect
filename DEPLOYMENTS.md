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
| Mode | Pool mode only. Writes come from the pool via `InvokeExternal`; nothing else can call `privacy_invoke` (`CALLER_NOT_POOL`). First live send still waits on the proving endpoint ([docs/15 § B2](docs/15-testnet-runbook.md)). |

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

Nothing of ours deployed. STRK20 pool (external):
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
(full address recovered 2026-09-05 from AVNU's production frontend bundle; class
`0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`, also declared on Sepolia).

## Benchmarks (measured on the deployments above)

| Tier | Tx | Fee |
| --- | --- | --- |
| 256 B message | `0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395` | 0.2076 STRK |
| 4 KiB message | `0x32a7b35d2ebe87d12cb7c53110963e6c9cb89f3e5ae100f91b52292969afe91` | 2.3185 STRK |

Details and the L2-execution-gas finding: [docs/15-testnet-runbook.md](docs/15-testnet-runbook.md) § A6.
