/**
 * The two one-line changes `scripts/patch-privacy-sdk.mjs` makes to the
 * vendored Privacy SDK — applied here to the SDK's BUILT compiler module as
 * Vite loads it, so the app works on any machine's checkout without running
 * the script and rebuilding sdk/dist. Idempotent: a patched file passes
 * through unchanged.
 *
 *   1. The pool sanctions zero-amount encrypted notes (privacy/src/actions.cairo);
 *      they are the free replay-protection carrier for message-only sends. The
 *      stock SDK refuses to create one ("Created note amount must be positive").
 *   2. A zero note can never be spent (the pool rejects UseNote on it), so it
 *      must never be auto-selected as an input.
 */
export function patchSdkCompiler(code: string): { code: string; applied: string[] } {
  const applied: string[] = [];
  let out = code;

  const createNote = /(isOpen\(c\.amount\)\s*\|\|\s*c\.amount\s*)>\s*0n/;
  if (createNote.test(out)) {
    out = out.replace(createNote, "$1>= 0n").replace(/Created note amount must be positive/, "Created note amount must be non-negative");
    applied.push("zero-amount created notes");
  }

  const skipUsed = /(if\s*\(usedNoteIds\.has\(note\.id\)\)\s*continue;[^\n]*\n)/;
  if (!/note\.amount === 0n\)\s*continue/.test(out) && skipUsed.test(out)) {
    out = out.replace(skipUsed, "$1 if (note.amount === 0n) continue; // PATCH (strk20-messaging): a zero note is a carrier, never an input\n");
    applied.push("never select zero notes as inputs");
  }
  return { code: out, applied };
}

/** True for the one SDK module the patch targets. */
export function isSdkCompilerModule(id: string): boolean {
  return /[\\/]sdk[\\/]dist[\\/]internal[\\/]compiler\.js(\?|$)/.test(id);
}
