import { afterEach, describe, expect, it, vi } from "vitest";
import { submitViaGateway } from "../src/lib/gateway.js";

/**
 * The gateway wire shape, pinned. The devnet e2e never goes through the
 * gateway (devnet has none), and the first browser attempt on Sepolia died on
 * exactly this: facts sent, proof missing (PROOF_FACTS_AND_PROOF_CONSISTENCY).
 */
const account = {
  address: "0x3ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4",
  getNonce: async () => "0x29",
  signer: { signTransaction: async () => ["1", "2"] },
};
const provider = { getChainId: async () => "0x534e5f5345504f4c4941" };
const bounds = {
  l1_gas: { max_amount: 100_000n, max_price_per_unit: 5n },
  l2_gas: { max_amount: 200_000_000n, max_price_per_unit: 7n },
  l1_data_gas: { max_amount: 4_000_000n, max_price_per_unit: 11n },
};
const call = { contractAddress: "0x254a", entrypoint: "apply_actions", calldata: ["0x1", "0x2"] };

afterEach(() => vi.restoreAllMocks());

describe("submitViaGateway — the wire shape StarkWare's gateway accepts", () => {
  it("posts proof facts AND the proof, everything 0x-hex, bounds upper-cased", async () => {
    let posted: any;
    vi.stubGlobal("fetch", async (_url: string, init: any) => {
      posted = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: "TRANSACTION_RECEIVED", transaction_hash: "0xabc" }) };
    });
    const hash = await submitViaGateway("http://gw", account as any, provider as any, call, bounds, {
      proofFacts: ["0x50524f4f4631", "0x1"],
      proof: "AQIC",
    });
    expect(hash).toBe("0xabc");
    expect(posted.type).toBe("INVOKE_FUNCTION");
    expect(posted.proof_facts).toEqual(["0x50524f4f4631", "0x1"]);
    expect(posted.proof).toBe("AQIC"); // the bug: this was undefined
    expect(posted.signature).toEqual(["0x1", "0x2"]);
    expect(posted.nonce).toBe("0x29");
    expect(Object.keys(posted.resource_bounds)).toEqual(["L1_GAS", "L2_GAS", "L1_DATA_GAS"]);
    expect(posted.resource_bounds.L2_GAS).toEqual({ max_amount: "0xbebc200", max_price_per_unit: "0x7" });
    for (const felt of posted.calldata) expect(felt).toMatch(/^0x[0-9a-f]+$/);
    expect(posted.nonce_data_availability_mode).toBe(0);
  });

  it("surfaces the gateway's own error code and message", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ code: "StarknetErrorCode.INVALID_PROOF", message: "Proof verification failed" }),
    }));
    await expect(
      submitViaGateway("http://gw", account as any, provider as any, call, bounds, { proofFacts: ["0x1"], proof: "AQ" })
    ).rejects.toThrow(/INVALID_PROOF.*Proof verification failed/);
  });

  it("omits both privacy fields when there is no proof (a plain transaction)", async () => {
    let posted: any;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      posted = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ transaction_hash: "0x1" }) };
    });
    await submitViaGateway("http://gw", account as any, provider as any, call, bounds, {});
    expect(posted.proof_facts).toBeUndefined();
    expect(posted.proof).toBeUndefined();
  });
});
