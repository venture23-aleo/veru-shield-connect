import { afterEach, describe, expect, it } from "vitest";
import { buildActions, classifyWalletError, connectWallet, deriveViewingKey, detectWallets, foldSignature, normalizeChainId, probeStrk20, readyWallets, strk20Submit, viewingKeyTypedData, WalletRequestError } from "../src/lib/wallet.js";

const g = globalThis as unknown as { window?: Record<string, unknown> };
afterEach(() => {
  delete g.window;
});

describe("wallet detection — injected objects, Ready first, aliases collapsed", () => {
  it("finds every window.starknet_* object with a request function, Ready ranked first", () => {
    const ready = { id: "ready", name: "Ready", request: async () => [], icon: { light: "l", dark: "d" } };
    g.window = {
      starknet_braavos: { id: "braavos", name: "Braavos", version: "4.2", request: async () => [] },
      starknet_ready: ready,
      starknet_argentX: ready, // the legacy alias: same object
      starknet: { id: "ready", name: "Ready", request: async () => [] }, // a distinct object with the same id: still one entry
      starknet_nothing: { id: "x" }, // no request(): not a wallet
    };
    const found = detectWallets();
    expect(found.map((w) => w.id)).toEqual(["ready", "braavos"]);
    expect(found.every((w) => typeof w.request === "function")).toBe(true);
    expect(found[0]?.icon).toBe("l");
    // The UI offers Ready only — Braavos has no STRK20 dapp API.
    expect(readyWallets().map((w) => w.id)).toEqual(["ready"]);
  });

  it("finds a wallet injected as a NON-enumerable property (how extensions define them)", () => {
    const win: Record<string, unknown> = {};
    Object.defineProperty(win, "starknet_argentX", { value: { id: "argentX", name: "Ready", request: async () => [] }, enumerable: false });
    g.window = win;
    expect(readyWallets().map((w) => w.id)).toEqual(["argentX"]);
  });

  it("no Ready → the UI gets an empty list even when other wallets are injected", () => {
    g.window = { starknet_braavos: { id: "braavos", name: "Braavos", request: async () => [] } };
    expect(detectWallets()).toHaveLength(1);
    expect(readyWallets()).toEqual([]);
  });

  it("connects: requestAccounts then requestChainId, chain normalised to hex", async () => {
    const calls: string[] = [];
    const w = {
      id: "braavos",
      name: "Braavos",
      request: async ({ type }: { type: string }) => {
        calls.push(type);
        return type === "wallet_requestAccounts" ? ["0xabc"] : "SN_SEPOLIA";
      },
    };
    expect(await connectWallet(w)).toEqual({ address: "0xabc", chainId: "0x534e5f5345504f4c4941" });
    expect(calls).toEqual(["wallet_requestAccounts", "wallet_requestChainId"]);
    expect(normalizeChainId("0x534E5F4D41494E")).toBe("0x534e5f4d41494e");
  });
});

describe("STRK20 probe — a balance list or NOT_REGISTERED both mean the wallet speaks STRK20", () => {
  const w = (request: (c: { type: string }) => Promise<unknown>) => ({ id: "braavos", name: "Braavos", request: request as never });
  it("balances → supported and registered", async () => {
    const r = await probeStrk20(w(async () => [{ token: "0x1", balance: "0x5" }]));
    expect(r).toEqual({ ok: true, registered: true, balances: [{ token: "0x1", balance: 5n }] });
  });
  it("NOT_REGISTERED → supported, not registered", async () => {
    const r = await probeStrk20(w(async () => Promise.reject({ code: 1, message: "NOT_REGISTERED" })));
    expect(r).toMatchObject({ ok: true, registered: false });
  });
  it("UNKNOWN_ERROR on the empty list, then a named-token answer → supported", async () => {
    const asked: unknown[] = [];
    const r = await probeStrk20(
      w(async (c) => {
        asked.push((c as { params?: { tokens: string[] } }).params?.tokens);
        if ((asked[asked.length - 1] as string[]).length === 0) throw { code: 163, message: "An error occurred (UNKNOWN_ERROR)" };
        return [{ token: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", balance: "0x0" }];
      })
    );
    expect(r).toMatchObject({ ok: true, registered: true });
    expect(asked).toHaveLength(2);
  });

  it("UNKNOWN_ERROR both ways → kind 'error', not 'unsupported': the method exists", async () => {
    const r = await probeStrk20(w(async () => Promise.reject({ code: 163, message: "An error occurred (UNKNOWN_ERROR)" })));
    expect(r).toMatchObject({ ok: false, kind: "error" });
    expect((r as { reason: string }).reason).toMatch(/has the STRK20 API but could not answer/);
  });

  it("method not found → unsupported, with advice", async () => {
    const r = await probeStrk20(w(async () => Promise.reject(new Error("Method not supported: wallet_strk20Balances"))));
    expect(r).toMatchObject({ ok: false, kind: "unsupported" });
    expect((r as { reason: string }).reason).toMatch(/does not implement/);
  });
  it("user refusal is its own message", async () => {
    const r = await probeStrk20(w(async () => Promise.reject({ code: 113, message: "An error occurred (USER_REFUSED_OP)" })));
    expect((r as { reason: string }).reason).toMatch(/declined/);
  });
});

describe("explainProbe — the chain says why the wallet cannot use an account", () => {
  it("a registered-on-chain account the wallet cannot read → 'registered by someone else', naming the app's own account", async () => {
    const { explainProbe } = await import("../src/lib/wallet.js");
    const failed = { ok: false as const, kind: "error" as const, reason: "UNKNOWN_ERROR" };
    // No RPC in tests: an unreachable URL leaves the support untouched.
    const r = await explainProbe(failed, "0x3ab7", "http://127.0.0.1:1", "0x1", ["0x3ab7"]);
    expect(r).toEqual(failed);
  });
});

describe("classifyWalletError — strings, {code,message}, Errors", () => {
  it("sorts the SNIP-36 error names and codes", () => {
    expect(classifyWalletError("INSUFFICIENT_PRIVATE_BALANCE")).toBe("INSUFFICIENT_PRIVATE_BALANCE");
    expect(classifyWalletError({ code: 119, message: "An error occurred" })).toBe("INSUFFICIENT_PRIVATE_BALANCE");
    expect(classifyWalletError({ message: "PRIVACY_LEAK: notes too young" })).toBe("PRIVACY_LEAK");
    expect(classifyWalletError({ code: -32601, message: "x" })).toBe("UNSUPPORTED");
    expect(classifyWalletError({ code: 114, message: "An error occurred (INVALID_REQUEST_PAYLOAD)" })).toBe("INVALID_REQUEST_PAYLOAD");
    expect(classifyWalletError({ code: 162, message: "x" })).toBe("API_VERSION_NOT_SUPPORTED");
    expect(classifyWalletError(new Error("something else"))).toBe("UNKNOWN");
  });

  it("a wallet that dislikes the payload is NOT 'unsupported' — the word alone does not decide", () => {
    expect(classifyWalletError(new Error("Unsupported amount: 0"))).toBe("UNKNOWN");
    expect(classifyWalletError(new Error("unsupported action type: invoke"))).toBe("INVALID_REQUEST_PAYLOAD"); // the method exists; this action does not
    expect(classifyWalletError(new Error("Method wallet_strk20InvokeTransaction not supported"))).toBe("UNSUPPORTED");
    expect(classifyWalletError(new Error("Not implemented"))).toBe("UNSUPPORTED");
  });
});

describe("buildActions — value first, helper call last", () => {
  const invoke = { contract: "0xhelper", calldata: ["0x1", "0x2"] };
  it("a payment: the transfers, then the invoke", () => {
    const a = buildActions([{ token: "0xt", recipient: "0xb0b", amount: 5n }, { token: "0xt", recipient: "0xca401", amount: 5n }], invoke, null);
    expect(a).toEqual([
      { type: "transfer", token: "0xt", amount: "0x5", recipient: "0xb0b" },
      { type: "transfer", token: "0xt", amount: "0x5", recipient: "0xca401" },
      { type: "invoke", contract: "0xhelper", calldata: ["0x1", "0x2"] },
    ]);
  });
  it("a message-only send: a carrier note to self, then the invoke", () => {
    const a = buildActions([], invoke, { token: "0xt", self: "0xme", amount: 0n });
    expect(a).toEqual([
      { type: "transfer", token: "0xt", amount: "0x0", recipient: "0xme" },
      { type: "invoke", contract: "0xhelper", calldata: ["0x1", "0x2"] },
    ]);
  });
  it("a transfer with no memo needs no carrier and no invoke", () => {
    const a = buildActions([{ token: "0xt", recipient: "0xb0b", amount: 1n }], null, { token: "0xt", self: "0xme", amount: 0n });
    expect(a).toHaveLength(1);
    expect(() => buildActions([], null, null)).toThrow(/nothing/);
  });
});

describe("strk20Submit — one-shot first, prepare+add only when the METHOD is missing, raw text always kept", () => {
  const actions = buildActions([], { contract: "0xh", calldata: ["0x1"] }, { token: "0xt", self: "0xme", amount: 0n });
  const wallet = (handlers: Record<string, () => Promise<unknown>>) => ({
    id: "braavos",
    name: "Braavos",
    request: (async ({ type }: { type: string }) => {
      const h = handlers[type];
      if (!h) throw new Error(`Method ${type} not supported`);
      return h();
    }) as never,
  });

  it("uses wallet_strk20InvokeTransaction when it exists", async () => {
    const r = await strk20Submit(wallet({ wallet_strk20InvokeTransaction: async () => ({ transaction_hash: "0xabc" }) }), actions);
    expect(r).toEqual({ txHash: "0xabc", route: "invoke" });
  });

  it("falls back to prepare + addInvokeTransaction with the proof attached", async () => {
    const seen: unknown[] = [];
    const w = {
      id: "braavos",
      name: "Braavos",
      request: (async (c: { type: string; params?: unknown }) => {
        seen.push(c);
        if (c.type === "wallet_strk20InvokeTransaction") throw { code: -32601, message: "Method not found" };
        if (c.type === "wallet_strk20PrepareInvoke") return { call: { contract_address: "0xpool", entry_point: "execute", calldata: ["0x1"] }, proof: { data: "p", output: [], proof_facts: ["0xf"] } };
        if (c.type === "wallet_addInvokeTransaction") return { transaction_hash: "0xdef" };
        throw new Error("unexpected");
      }) as never,
    };
    const r = await strk20Submit(w, actions);
    expect(r).toEqual({ txHash: "0xdef", route: "prepare+add" });
    const add = seen.find((c) => (c as { type: string }).type === "wallet_addInvokeTransaction") as { params: { calls: unknown[]; proof: { proof_facts: string[] } } };
    expect(add.params.calls).toHaveLength(1);
    expect(add.params.proof.proof_facts).toEqual(["0xf"]);
  });

  it("a payload rejection does NOT fall back, and the wallet's own words survive", async () => {
    const w = wallet({
      wallet_strk20InvokeTransaction: async () => {
        throw { code: 114, message: "An error occurred (INVALID_REQUEST_PAYLOAD)", data: "amount must be > 0" };
      },
      wallet_strk20PrepareInvoke: async () => {
        throw new Error("should not be called");
      },
    });
    const err = await strk20Submit(w, actions).catch((e) => e);
    expect(err).toBeInstanceOf(WalletRequestError);
    expect((err as WalletRequestError).kind).toBe("INVALID_REQUEST_PAYLOAD");
    expect((err as WalletRequestError).message).toMatch(/Braavos rejected wallet_strk20InvokeTransaction: .*amount must be > 0/);
  });

  it("UNKNOWN_ERROR from the one-shot path tries prepare+add once, and reports both when that fails too", async () => {
    let prepared = 0;
    const w = {
      id: "ready",
      name: "Ready X",
      request: (async (c: { type: string }) => {
        if (c.type === "wallet_strk20InvokeTransaction") throw { code: 163, message: "An error occurred (UNKNOWN_ERROR)" };
        if (c.type === "wallet_strk20PrepareInvoke") {
          prepared++;
          return { call: { contract_address: "0xpool", entry_point: "execute", calldata: ["0x1"] }, proof: { data: "p", output: [], proof_facts: ["0xf"] } };
        }
        if (c.type === "wallet_addInvokeTransaction") return { transaction_hash: "0x123" };
        throw new Error("unexpected");
      }) as never,
    };
    expect(await strk20Submit(w, actions)).toEqual({ txHash: "0x123", route: "prepare+add" });
    expect(prepared).toBe(1);
    const both = wallet({
      wallet_strk20InvokeTransaction: async () => {
        throw { code: 163, message: "An error occurred (UNKNOWN_ERROR)" };
      },
      wallet_strk20PrepareInvoke: async () => {
        throw { code: 163, message: "An error occurred (UNKNOWN_ERROR)" };
      },
    });
    const err = (await strk20Submit(both, actions).catch((e) => e)) as WalletRequestError;
    expect(err.kind).toBe("UNKNOWN");
    expect(err.raw).toMatch(/UNKNOWN_ERROR.*wallet_strk20PrepareInvoke.*UNKNOWN_ERROR/);
  });

  it("neither route: both raw answers are reported", async () => {
    const err = await strk20Submit(wallet({}), actions).catch((e) => e);
    expect((err as WalletRequestError).kind).toBe("UNSUPPORTED");
    expect((err as WalletRequestError).raw).toMatch(/wallet_strk20InvokeTransaction not supported .* wallet_strk20PrepareInvoke/);
  });
});

describe("viewing key from a wallet signature — deterministic, in the curve order, never zero", () => {
  it("folds r,s (or a guardian-extended signature) with Poseidon and reduces", async () => {
    const a = await foldSignature(["0x1", "0x2"]);
    const b = await foldSignature(["0x1", "0x2"]);
    const c = await foldSignature(["0x1", "0x3"]);
    const four = await foldSignature(["0x1", "0x2", "0x3", "0x4"]); // owner + guardian
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(four).not.toBe(a);
    const { ec } = await import("starknet");
    for (const k of [a, c, four]) {
      expect(BigInt(k)).toBeGreaterThan(0n);
      expect(BigInt(k)).toBeLessThan(ec.starkCurve.CURVE.n);
    }
    expect(await foldSignature({ r: "0x1", s: "0x2" })).toBe(a);
    await expect(foldSignature([])).rejects.toThrow(/no signature/);
  });

  it("asks the wallet to sign a fixed SNIP-12 message bound to chain, pool and account", async () => {
    const seen: unknown[] = [];
    const w = {
      id: "ready",
      name: "Ready",
      request: (async (c: { type: string; params?: unknown }) => {
        seen.push(c);
        return ["0xabc", "0xdef"];
      }) as never,
    };
    const vk = await deriveViewingKey(w, "0xa11ce", "0x534e5f5345504f4c4941", "0xp00l");
    expect(vk).toBe(await foldSignature(["0xabc", "0xdef"]));
    const req = seen[0] as { type: string; params: ReturnType<typeof viewingKeyTypedData> };
    expect(req.type).toBe("wallet_signTypedData");
    expect(req.params.primaryType).toBe("ViewingKey");
    expect(req.params.message).toEqual({ purpose: "strk20-messaging/viewing-key/v1", pool: "0xp00l", account: "0xa11ce" });
    expect(req.params.domain.chainId).toBe("0x534e5f5345504f4c4941");
  });
});

describe("walletWaitText — expectation-setting from elapsed time and the remembered typical duration", () => {
  it("phases: approve → proving (with the typical time) → longer than usual", async () => {
    const { walletWaitText } = await import("../src/lib/walletBackend.js");
    expect(walletWaitText(3, 80, "Ready X")).toMatch(/approve the prompt/);
    expect(walletWaitText(30, 80, "Ready X")).toMatch(/usually ~80 s/);
    expect(walletWaitText(140, 80, "Ready X")).toMatch(/longer than usual/);
    expect(walletWaitText(30, null, "Ready X")).toMatch(/first send here/);
  });
});
