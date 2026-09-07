# 18 — New pool account runbook (create, key, register)

Create a brand-new Starknet account you fully control, give it a viewing key you
choose, and register it on the Sepolia STRK20 pool so the chat app can run as it.
Use this whenever an account you hold both keys for is needed — for example to
receive private transfers from a Ready/Xverse wallet, since a wallet-managed
account's viewing key is custodied by the wallet and cannot be imported.

All commands are run from the repo root. Nothing here prints a private key to the
terminal beyond the accounts file that `sncast` writes; treat that file as secret.

## Prerequisites

- `sncast` 0.63+ on PATH, using the default accounts file
  `~/.starknet_accounts/starknet_open_zeppelin_accounts.json` (the one that holds
  `deployer` and `safari`).
- A funding account with spare Sepolia STRK — `deployer` here.
- The self-hosted transaction prover running on `http://127.0.0.1:3000`
  (`sudo docker ps` should show `strk20-prover`). Registration needs it.
- A working Sepolia RPC. `sncast` calls below use the public
  `https://starknet-sepolia.drpc.org`; the register script defaults to the
  Cartridge v0_10 RPC (it needs storage proofs).

Shell variables used throughout:

```bash
RPC=https://starknet-sepolia.drpc.org
STRK=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
POOL=0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91
NAME=appacct2   # a fresh, unused account name
```

## Step 1 — Create the account

```bash
sncast account create --name "$NAME" --type open-zeppelin --url "$RPC"
```

This writes the address and its private key into the accounts file and prints the
**address** plus an estimated deployment fee. Save the address:

```bash
NEW=$(python3 -c "import json;print(json.load(open('$HOME/.starknet_accounts/starknet_open_zeppelin_accounts.json'))['alpha-sepolia']['$NAME']['address'])")
echo "$NEW"
```

The account is not on chain yet.

## Step 2 — Fund it

Registration proves a transaction whose gas ceiling reserves roughly **10.7 STRK**
(the pool requires balance ≥ `l2_gas_max × price`, even though actual usage is far
less), plus the 2 STRK pool fee, plus deployment and approve gas. Fund ~25 STRK so
there is comfortable margin:

```bash
sncast --account deployer invoke --url "$RPC" \
  --contract-address "$STRK" --function transfer \
  --calldata "$NEW" 25000000000000000000 0
```

Wait for it to land:

```bash
sncast call --url "$RPC" --contract-address "$STRK" \
  --function balanceOf --calldata "$NEW"
```

Underfunding is the cause of `VALIDATE_FAILURE: Resources bounds … exceed balance`
in step 5. If you see that, add more STRK and retry.

## Step 3 — Deploy the account

```bash
sncast account deploy --url "$RPC" --name "$NAME"
```

Confirm on chain:

```bash
sncast call --url "$RPC" --contract-address "$STRK" \
  --function balanceOf --calldata "$NEW"   # still ~25 STRK minus a small deploy fee
```

## Step 4 — Approve the pool to collect its fee

The pool takes its 2 STRK fee by `transferFrom`, so the account must approve it
first. Skipping this makes step 5 revert with `Insufficient ERC20 allowance`:

```bash
sncast --account "$NAME" invoke --url "$RPC" \
  --contract-address "$STRK" --function approve \
  --calldata "$POOL" 100000000000000000000 0
```

One generous approval (100 STRK here) covers many future actions.

## Step 5 — Generate a viewing key and register it

The register script generates a fresh viewing key into a per-account file and
proves + submits the `SetViewingKey` action. `VIEWING_KEY_FILE` keeps this account's
key separate from any other account's (without it, the script reuses
`~/.strk20-msg/sepolia-viewing-key`, which belongs to `deployer`).

```bash
PK=$(python3 -c "import json;print(json.load(open('$HOME/.starknet_accounts/starknet_open_zeppelin_accounts.json'))['alpha-sepolia']['$NAME']['private_key'])")

ACCOUNT_ADDRESS="$NEW" \
STRK20_MSG_PRIVATE_KEY="$PK" \
VIEWING_KEY_FILE="$NAME-viewing-key" \
  node scripts/sepolia-prove-register.mjs --submit-gateway
```

Expected tail:

```
✓ proved in ~5 s · proof_facts: 9 felts …
posting to https://alpha-sepolia.starknet.io/gateway/add_transaction …
✓ ACCEPTED — the account is registered on the Sepolia pool
```

The viewing key is saved to `~/.strk20-msg/$NAME-viewing-key` (mode 0600).
**Back it up. It is this account's inbox, and registration is write-once — it can
never be changed or regenerated.**

## Step 6 — Verify

```bash
VIEWING_KEY=$(cat ~/.strk20-msg/$NAME-viewing-key | tr -d '[:space:]') \
ACCOUNT_ADDRESS="$NEW" \
  node scripts/pool-notes.mjs
```

Look for `registered YES (viewing pubkey 0x…)`. `notes: 0` is correct for a new
account. If it prints a mismatch, the viewing key in the file does not match what
was registered — do not proceed.

## Step 7 — Put the three values in the app

Collect them:

```bash
echo "address:     $NEW"
echo "private key: $PK"
echo "viewing key: $(cat ~/.strk20-msg/$NAME-viewing-key | tr -d '[:space:]')"
```

In the app, Settings → Pool:

| Field | Value |
| --- | --- |
| RPC URL | a Sepolia endpoint (e.g. `https://starknet-sepolia.drpc.org`) — **local toggle OFF** |
| Pool address | `0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Account address | the address above |
| Private key | the private key above |
| Viewing key | the viewing key above |

Save. The mismatch banner stays clear because the viewing key matches the
registered pubkey.

## What this account can and cannot do

- **Receive private transfers with no screening.** A Ready/Xverse wallet (or any
  already-shielded account) can privately transfer to this address, and the app
  reads those notes as this account. This is the funding path.
- **Send private payments and messages** through the pool, once it holds notes.
- **It cannot shield its own public STRK from the app** — the app hits the
  operator's `SCREENING_REQUIRED` on deposit. Shielding still happens inside a
  wallet; this account is the private-transfer destination.

## Derivation note (why there is no "derive viewing key from private key")

The account **address** derives from its deployment: class hash, salt, and its
signing public key `getStarkKey(privateKey)`. The **viewing key** is an independent
secret you generate in step 5 and register in the same step; it is unrelated to the
private key. The pool binds them only by storing `getStarkKey(viewingKey)` for the
address. So you hold two independent secrets for one account — keep both.
