# 20 — Wallet mode: Ready through the STRK20 wallet API

**Added 2026-09-07.** A fourth connection mode. The user's wallet holds the account key
*and* the STRK20 viewing key; it proves, signs and submits every transaction behind its own
prompt. The app never sees a key and needs no proving-service URL.

## The API

SNIP-36's wallet methods, typed in `@starknet-io/types-js` 0.10 and exposed by starknet.js 10.5
(`WalletAccountV6`). We call the injected object directly (`window.starknet_braavos`,
`window.starknet_ready`) — `request({ type, params })` is the whole protocol
([apps/web/src/lib/wallet.ts](../../apps/web/src/lib/wallet.ts)):

| Method | Used for |
| --- | --- |
| `wallet_requestAccounts`, `wallet_requestChainId`, `wallet_switchStarknetChain` | connect; make sure the wallet is on the preset's network |
| `wallet_strk20Balances` | the support probe (read-only, safe on any wallet) and the "in pool" balance |
| `wallet_strk20InvokeTransaction` | every send: `transfer` actions for value, one `invoke` action on the helper for the memo; a `deposit` action for shield |

A payment with a memo is `[transfer × N, invoke(helper, privacy_invoke calldata)]` — the same
one-transaction shape as pool mode ([16](16-arch1-plan.md)), assembled by `buildActions`. A
message-only send carries a **1 wei transfer to self** first — the pool's WriteOnce replay
protection (M0 § S1). The pool would accept a zero note, but the wallet proves with the stock
SDK, whose client-side check refuses it ("Created note amount must be positive" — seen from
Ready X on Sepolia 2026-09-07), and a wallet cannot be patched. So in wallet mode a message
needs one spendable shielded note of the carrier token inside the wallet; 1 wei of it per
message is spent.

## What changes versus holding keys ourselves

| | Pool mode (own keys) | Wallet mode |
| --- | --- | --- |
| Message lanes | pool channel keys, derived from our viewing key | **address-derived pair lanes** (`devPairLane`), as in direct mode — the wallet keeps the viewing key |
| Who can be messaged | registered pool users | anyone with an address; **payments** still need the recipient registered (`get_public_key ≠ 0`) |
| Notes | enumerated by discovery → per-note receipts | `wallet_strk20Balances` is a sum → no receipt line, balance only |
| Proving | our prover URL | the wallet's |
| Signing | pasted private key | the wallet's prompt |

Address-derived lanes are less confidential than pool channels (anyone who guesses the pair can
derive the key), and the thread head says so. Everything inside a lane is still AEAD-sealed.

## Prerequisites

- A wallet that implements `wallet_strk20*`. **Ready** (formerly Argent X) is the one the
  Privacy Wallet API shipped with, and the UI lists it first. **Braavos** (checked 2026-09-07)
  answers `Not implemented` to every `wallet_strk20*` method — it shows private balances in
  its own UI but exposes nothing to dapps — so it cannot send here. The probe at onboarding
  and the diagnostic in Settings say which you have; **do not assume**.
- The account must be **registered on the pool**: shield any amount once inside the wallet.
  `wallet_strk20Balances` answers `NOT_REGISTERED` until then, and Settings says so.
- The helper contract on the same network as the wallet. Sepolia: the pool-mode helper. Mainnet:
  deploy `contracts/` with `pool` = the mainnet pool first, then paste the address.

## RPC

starknet.js 10.5 accepts spec 0.9.0 and 0.10.2. Verified 2026-09-07: Cartridge's
`…/sepolia/rpc/v0_10` and `…/mainnet/rpc/v0_10` serve 0.10.2; drpc serves 0.10.3 (rejected);
Blast is shut down; the Day 0 guide's lava endpoint is discontinued.

## Route B — Ready X as signer, this app as prover (added 2026-09-07, evening)

Sepolia showed the limit of route A: Ready X answers `NOT_REGISTERED` to every STRK20
action (deposit included) until the wallet has registered the account **itself**, and the
wallet offered no activation flow on Sepolia for the account we had. A dapp cannot trigger that
registration. So the app now has a second route that needs nothing from the wallet's own
privacy support — only signing:

1. **Viewing key from a signature.** `wallet_signTypedData` on a fixed SNIP-12 message bound
   to chain, pool and account (`wallet.ts viewingKeyTypedData`); the felts are folded with
   Poseidon and reduced into the curve order. Deterministic: reconnecting re-derives it. It is
   *this app's* key, held in the browser like a pasted one; the pool holds one key per
   account, so an account is on this route **or** the wallet's, not both.
2. **Proving** by the app's prover (`/prover`, the self-hosted container), exactly as pool mode
   with a pasted key.
3. **Signing** by the wallet: plain calls (fee approval, shield's approve) through
   `wallet_addInvokeTransaction`; pool calls through the same method with the SNIP-36
   `proof` (`{data, output, proof_facts}`) attached — the transaction hash folds the proof
   facts in, and the wallet submits through its own node. `poolBackend.ts` keeps one `Signer`
   abstraction for both (`key` → gateway/RPC as before; `wallet` → the wallet).

Everything above the backend is unchanged: pool channels, discovery, receipts, splits — it is
pool mode, minus the pasted key. The one thing not verifiable without the wallet in hand: that
the installed Ready X honours `proof` on `wallet_addInvokeTransaction` (it is in the v0.10.3
wallet API it otherwise implements). If it does not, the first registration fails with the
wallet's own words and the advice to use a pasted key.

Where to start it: onboarding → Connect Ready X wallet → **Use Ready X as signer**; or
Settings → Pool → **Sign with Ready X instead of a key**. Still true on Sepolia: deposits need
the operator's screening (15 § B10), so this route sends **messages and requests**; payments
need notes that reach the account from inside the pool.
