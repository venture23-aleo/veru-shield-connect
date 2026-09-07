/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Submit a proof-carrying invoke straight to StarkWare's gateway.
 *
 * Why not the RPC: on Sepolia (2026-09-07) Cartridge's `addInvokeTransaction`
 * path mangles the privacy fields — its node is a protocol version behind
 * (expects PROOF0 facts; the chain is on PROOF1) — and every submission died
 * with "Account: invalid signature". The gateway parses `proof_facts`/`proof`,
 * verifies the proof itself, and accepted our first registration
 * (tx 0x7c0196fc…5700e). Devnet has no gateway; its RPC path is fine.
 *
 * The transaction hash starknet.js signs folds `poseidon(proof_facts)` in as
 * the last element — verified to reproduce a mined pool transaction's hash.
 */
import type { Account, Call, RpcProvider } from "starknet";

export const GATEWAYS: Record<string, string> = {
  "0x534e5f5345504f4c4941": "https://alpha-sepolia.starknet.io/gateway/add_transaction", // SN_SEPOLIA
  "0x534e5f4d41494e": "https://alpha-mainnet.starknet.io/gateway/add_transaction", // SN_MAIN
};

export interface ProofDetails {
  proofFacts?: unknown[];
  proof?: unknown;
}

export interface ResourceBounds {
  l1_gas: { max_amount: bigint; max_price_per_unit: bigint };
  l2_gas: { max_amount: bigint; max_price_per_unit: bigint };
  l1_data_gas: { max_amount: bigint; max_price_per_unit: bigint };
}

const hex = (v: unknown) => "0x" + BigInt(v as string | number | bigint).toString(16);

/** Sign as the account would for `execute`, then post the gateway wire shape. Returns the tx hash. */
export async function submitViaGateway(
  gatewayUrl: string,
  account: Account,
  provider: RpcProvider,
  calls: Call | Call[],
  resourceBounds: ResourceBounds,
  proof: ProofDetails
): Promise<string> {
  const { stark, transaction } = await import("starknet");
  const list = Array.isArray(calls) ? calls : [calls];
  const chainId = await provider.getChainId();
  const nonce = await account.getNonce();
  const details: any = {
    walletAddress: account.address,
    nonce,
    version: "0x3",
    chainId,
    cairoVersion: "1",
    resourceBounds,
    tip: 0n,
    paymasterData: [],
    accountDeploymentData: [],
    nonceDataAvailabilityMode: "L1",
    feeDataAvailabilityMode: "L1",
    ...(proof.proofFacts?.length ? { proofFacts: proof.proofFacts, proof: proof.proof } : {}),
  };
  const signature = await (account.signer as any).signTransaction(list, details);
  const calldata = transaction.getExecuteCalldata(list, "1");
  if (!calldata.length) throw new Error("empty execute calldata — refusing to submit");
  const rb = (b: { max_amount: bigint; max_price_per_unit: bigint }) => ({
    max_amount: hex(b.max_amount),
    max_price_per_unit: hex(b.max_price_per_unit),
  });
  // The gateway wants 0x-hex everywhere; starknet.js emits decimal strings.
  const body = {
    type: "INVOKE_FUNCTION",
    version: "0x3",
    sender_address: account.address,
    calldata: calldata.map(hex),
    signature: stark.formatSignature(signature).map(hex),
    nonce: hex(nonce),
    tip: "0x0",
    paymaster_data: [],
    account_deployment_data: [],
    nonce_data_availability_mode: 0,
    fee_data_availability_mode: 0,
    resource_bounds: {
      L1_GAS: rb(resourceBounds.l1_gas),
      L2_GAS: rb(resourceBounds.l2_gas),
      L1_DATA_GAS: rb(resourceBounds.l1_data_gas),
    },
    ...(proof.proofFacts?.length ? { proof_facts: proof.proofFacts.map(hex), proof: proof.proof } : {}),
  };
  const res = await fetch(gatewayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: { transaction_hash?: string; code?: string; message?: string } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || !parsed?.transaction_hash) {
    throw new Error(`gateway ${res.status}: ${parsed?.code ?? ""} ${parsed?.message ?? text.slice(0, 300)}`.trim());
  }
  return parsed.transaction_hash;
}
