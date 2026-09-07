#!/usr/bin/env bash
# Declare, deploy and verify MessageAnonymizer on STARKNET MAINNET.
#
# Read docs/21-mainnet-deployment-checklist.md first. Real money, permanent
# contract: the constructor pins `pool` forever.
#
# Prerequisites:
#   - scarb 2.17.0, sncast 0.63.0 on PATH
#   - a funded MAINNET sncast account (sncast account import … --network mainnet)
#     holding at least ~5 STRK for declare + deploy
#   - nothing else: POOL_ADDRESS and RPC_URL default to the verified mainnet values
#
# Usage:
#   ACCOUNT=<mainnet account name> ./deploy/mainnet.sh
#   (override RPC_URL / POOL_ADDRESS only if you know why)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${ACCOUNT:?set ACCOUNT to your funded MAINNET sncast account name}"
POOL_ADDRESS="${POOL_ADDRESS:-0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a}"
RPC_URL="${RPC_URL:-https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10}"
MAINNET_CHAIN_ID="0x534e5f4d41494e"

echo "== guard: the RPC must be MAINNET"
CHAIN=$(curl -s -m 20 -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_chainId","params":[]}' | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')
[ "$CHAIN" = "$MAINNET_CHAIN_ID" ] || { echo "RPC $RPC_URL reports chain $CHAIN, not SN_MAIN ($MAINNET_CHAIN_ID). Stop."; exit 1; }

echo "== guard: the pool must answer get_fee_amount (a real STRK20 pool)"
sncast call --url "$RPC_URL" --contract-address "$POOL_ADDRESS" --function get_fee_amount >/dev/null \
  || { echo "$POOL_ADDRESS does not answer get_fee_amount on mainnet. Stop."; exit 1; }

echo
echo "About to DECLARE + DEPLOY MessageAnonymizer on MAINNET"
echo "  account : $ACCOUNT"
echo "  pool    : $POOL_ADDRESS (pinned forever by the constructor)"
echo "  rpc     : $RPC_URL"
read -r -p "Type 'mainnet' to continue: " CONFIRM
[ "$CONFIRM" = "mainnet" ] || { echo "aborted"; exit 1; }

scarb build

echo "== declaring MessageAnonymizer"
DECLARE_OUT=$(sncast --account "$ACCOUNT" declare \
  --url "$RPC_URL" --contract-name MessageAnonymizer 2>&1) || {
  echo "$DECLARE_OUT" | grep -qi "already declared" || { echo "$DECLARE_OUT"; exit 1; }
  echo "$DECLARE_OUT"
}
CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oiE "class[ _]hash: +0x[0-9a-fA-F]+" | grep -oE "0x[0-9a-fA-F]+" | head -1 || true)
[ -n "$CLASS_HASH" ] || CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oE "0x[0-9a-fA-F]{50,}" | head -1)
echo "class_hash: $CLASS_HASH"

echo "== deploying with pool = $POOL_ADDRESS"
DEPLOY_OUT=$(sncast --account "$ACCOUNT" deploy \
  --url "$RPC_URL" --class-hash "$CLASS_HASH" \
  --constructor-calldata "$POOL_ADDRESS")
echo "$DEPLOY_OUT"
CONTRACT_ADDRESS=$(echo "$DEPLOY_OUT" | grep -oiE "contract[ _]address: +0x[0-9a-fA-F]+" | grep -oE "0x[0-9a-fA-F]+" | head -1 || true)
[ -n "$CONTRACT_ADDRESS" ] || { echo "could not parse contract address from:"; echo "$DEPLOY_OUT"; exit 1; }
DEPLOY_TX=$(echo "$DEPLOY_OUT" | grep -oiE "transaction[ _]hash: +0x[0-9a-fA-F]+" | grep -oE "0x[0-9a-fA-F]+" | head -1 || true)

echo "== sanity: pool() must echo the constructor arg"
sncast call --url "$RPC_URL" --contract-address "$CONTRACT_ADDRESS" --function pool

echo "== verifying source (Voyager)"
sncast --account "$ACCOUNT" verify \
  --url "$RPC_URL" --contract-address "$CONTRACT_ADDRESS" \
  --contract-name MessageAnonymizer --verifier voyager --network mainnet || \
  echo "verification failed or needs manual submission — record the address either way"

cat <<DONE

MessageAnonymizer deployed on MAINNET
  address    : $CONTRACT_ADDRESS
  class hash : $CLASS_HASH
  deploy tx  : ${DEPLOY_TX:-see output above}
  explorer   : https://voyager.online/contract/$CONTRACT_ADDRESS

Next (docs/21-mainnet-deployment-checklist.md § after deploy):
  1. DEPLOYMENTS.md → Mainnet section, same commit
  2. apps/web/src/lib/presets.ts → MAINNET_WALLET_PRESET.helperAddress
  3. strk20.json → "contracts": ["$CONTRACT_ADDRESS"]
DONE
