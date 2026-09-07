import { describe, expect, it } from "vitest";
import { isSdkCompilerModule, patchSdkCompiler } from "../sdkPatch.js";

// The stock SDK's built compiler.js, verbatim shapes (tsc output of bc75e4b).
const STOCK = `
            for (const c of actions.createNotes) {
                assert(isOpen(c.amount) || c.amount > 0n, () => \`Created note amount must be positive (token: \${toHex(c.token)})\`);
                if (!isOpen(c.amount)) {
                    update(c.token, -c.amount);
                }
            }
                for (const note of availableNotes.slice().sort((a, b) => Number(b.amount - a.amount))) {
                    if (usedNoteIds.has(note.id))
                        continue; // Skip used notes
                    actions.useNotes.push({ token, note });
`;

describe("Privacy SDK zero-note patch, applied at bundle time", () => {
  it("relaxes the created-note assert and skips zero notes as inputs", () => {
    const { code, applied } = patchSdkCompiler(STOCK);
    expect(applied).toEqual(["zero-amount created notes", "never select zero notes as inputs"]);
    expect(code).toContain("c.amount >= 0n");
    expect(code).toContain("must be non-negative");
    expect(code).not.toContain("must be positive");
    expect(code).toMatch(/continue; \/\/ Skip used notes\n if \(note\.amount === 0n\) continue;/);
  });

  it("is idempotent: an already-patched file passes through untouched", () => {
    const once = patchSdkCompiler(STOCK).code;
    const twice = patchSdkCompiler(once);
    expect(twice.applied).toEqual([]);
    expect(twice.code).toBe(once);
  });

  it("targets only the SDK's compiler module", () => {
    expect(isSdkCompilerModule("/home/x/.cache/scarb/registry/git/checkouts/starknet-privacy-abc/bc75e4b/sdk/dist/internal/compiler.js")).toBe(true);
    expect(isSdkCompilerModule("/x/sdk/dist/internal/compiler.js?v=123")).toBe(true);
    expect(isSdkCompilerModule("/x/sdk/dist/internal/builders.js")).toBe(false);
    expect(isSdkCompilerModule("/x/src/lib/poolBackend.ts")).toBe(false);
  });
});
