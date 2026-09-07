#!/usr/bin/env bash
# Declare, deploy and verify MessageAnonymizer on Sepolia.
#
# Prerequisites:
#   - scarb 2.17.0, sncast 0.63.0 on PATH
#   - a funded sncast account:  sncast account create/import  (see sncast docs)
#   - POOL_ADDRESS: the FULL STRK20 Sepolia pool address (0x0254a6b2…e0d91 —
#     obtain the untruncated form before running; the constructor pins it forever)
#
# Usage:
#   POOL_ADDRESS=0x... ACCOUNT=deployer ./deploy/sepolia.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${POOL_ADDRESS:?set POOL_ADDRESS to the full STRK20 Sepolia pool address}"
: "${ACCOUNT:?set ACCOUNT to your sncast account name}"
RPC_URL="${RPC_URL:-https://starknet-sepolia.drpc.org}"

scarb build

echo "== declaring MessageAnonymizer"
DECLARE_OUT=$(sncast --account "$ACCOUNT" declare \
  --url "$RPC_URL" --contract-name MessageAnonymizer 2>&1) || {
  # An already-declared class is fine; reuse its hash.
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

echo "== sanity: pool() must echo the constructor arg"
sncast call --url "$RPC_URL" \
  --contract-address "$CONTRACT_ADDRESS" --function pool

echo "== verifying source (Voyager)"
sncast --account "$ACCOUNT" verify \
  --url "$RPC_URL" --contract-address "$CONTRACT_ADDRESS" \
  --contract-name MessageAnonymizer --verifier voyager --network sepolia || \
  echo "verification failed or needs manual submission — record the address either way"

echo
echo "MessageAnonymizer deployed at: $CONTRACT_ADDRESS"
echo "Record it in DEPLOYMENTS.md (same commit)"
