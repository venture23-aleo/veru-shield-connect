# 09 — Open Decisions

Adopting STRK20 resolved five of the eight decisions in the previous revision outright, and
replaced two more with sharper versions. The genuinely open questions are now smaller,
better-defined, and mostly answerable by reading source or running a benchmark rather than by
architectural argument.

## Resolved by adopting STRK20

| # | Question | Resolution |
| --- | --- | --- |
| D1 | Which privacy pool? | **STRK20**, deployed Mainnet `0x040337b1…e812a` / Sepolia `0x0254a6b2…e0d91`. Inherits a live anonymity set. |
| D3 | Relayer trust model | No relayer to build. A paymaster decouples the submitter; see [D3′](#d3-which-paymaster). |
| D4 | Curve choice | **STARK curve**, Poseidon. No second key for users to back up. |
| D5 | Message volume / discovery scaling | Dense-index walk scales with *your* channels, not pool volume. Fuzzy Message Detection is unnecessary. |
| D7 | Messaging-key discovery | On-chain `SetViewingKey` registry already exists. No out-of-band exchange, no registry to build. |
| D8 | Proof system | **Stwo**, verified in-protocol by Starknet. No Garaga verifier, no trusted setup, no benchmark. |

Two of these — D1 and D8 — were the previous revision's "blocking, answer before writing code"
items. Both are closed.

---

## D2′ — The proof-validity window

<span>**Resolved**</span>

`proof_validity_blocks` defaults to **450 blocks — roughly 15 minutes at 2 s/block** — and is
governance-settable. Against ~29 s of proving that is a comfortable margin, not the race the
previous revision flagged.

Two related conventions matter more in practice, and both belong in the SDK wrapper rather than
in application code:

- **Prove at `currentBlock − 10`,** not at the head. Notes mature 10 blocks after creation, and
  proving at the head risks reorg invalidation.
- **Re-fetch `provingBlockId` after every `waitForTransaction`** when chaining transactions.

---

## D3′ — Which paymaster {#d3-which-paymaster}

<span>**Shapes v1 · product decision**</span>

AVNU's paymaster is documented and in production; self-hosting gives control and makes you the
single visible submitter for all your users; direct submission needs no third party but exposes
the user's address. See [08-submission.md](08-submission.md#choosing-a-paymaster).

**Recommendation:** AVNU for v1 with the API key held server-side, self-hosted paymaster as a
fast follow, direct submission always available as a liveness fallback with an explicit warning.

---

## D9 — Where does the payload live?

<span>**Resolved by M0 — helper storage; see [14-m0-decision-record.md](14-m0-decision-record.md)**</span>

The design files ciphertext in the helper's WriteOnce storage, matching the pool's own
convention and making discovery a storage read. The cost is real: **one slot per 31 bytes**,
billed as L1 data gas — a 1 KiB message is ~34 slots.

| Option | Trade-off |
| --- | --- |
| **Helper storage** (current design) | Consistent with notes; discovery is a plain RPC read; permanent. Most expensive. |
| **Events** | Far cheaper (L2 gas). But event data is not in the L1 state diff, and discovery becomes a log query rather than a slot read — a different scan with different availability. |
| **Hybrid** | Body in an event, a commitment in one storage slot. Cheap and anchored, but discovery needs both paths. |
| **Off-chain body** | Only a locator and key on-chain. Cheapest; reintroduces an availability dependency the current design does not have. |

**Benchmark a 256 B and a 4 KiB message on Sepolia before committing.** This is a cheap
experiment and it constrains the padding buckets, the product's message-size ceiling, and the
per-message price the user sees.

---

## D10 — Do we inherit auditability?

<span>**Blocking · product and ethics decision**</span>

Filing messages under STRK20 channel keys means the escrowed auditor key recovers **message
content**, not just payment history ([02-threat-model.md](02-threat-model.md#the-escrowed-auditor-key)).

- **Inherit it.** One key, one backup, full consistency with the pool's compliance model.
  Content is disclosable under lawful process.
- **Escape it.** Derive body keys from material outside the viewing-key hierarchy, so the
  auditor recovers metadata but not plaintext. Costs the single-key property, and arguably
  works against the pool's compliance design in a way its operators may not welcome.

**Recommendation:** inherit, and state it plainly in the product. Then remove anonymous tips
and dissident communication from the pitch rather than qualifying them — a privacy product that
overstates its threat model is worse than one with a narrower honest claim.

---

## D11 — Client shape under ~29 s proving

<span>**Shapes the product**</span>

Proving latency plus one-invoke-per-transaction means the client is an outbox that batches and
flushes, not a chat window. Is that acceptable for the intended product, or does the target use
case need sub-second sends?

If it does, this is the wrong substrate and that should be known now, not after the helper is
written. Payment memos and escrow negotiation tolerate 30 s comfortably. Conversational chat
does not.

---

## D12 — Does a zero-value invoke work?

<span>**Resolved by M0 — yes, with a zero-amount `CreateEncNote` carrier; see [14-m0-decision-record.md](14-m0-decision-record.md)**</span>

The whole pure-message path assumes a helper can be invoked with no token movement, returning
an empty `Span<OpenNoteDeposit>`. STRK20's docs state an empty span is valid, and the escrow
helper's deposit step relies on it — but the balance invariant ("every token's balance must end
at exactly zero") has not been checked for a transaction that moves no tokens at all.

**Verify against [starkware-libs/starknet-privacy](https://github.com/starkware-libs/starknet-privacy)
before anything else.** If a pure-message transaction is rejected, every message must carry a
token movement — a dust self-transfer, most likely — which changes cost, UX, and the threat
model.

---

## Verification list

Claims in these docs drawn from STRK20's documentation rather than its source:

1. **Channel-key and note-id derivations** are exactly as documented — the SDK must match
   byte-for-byte or discovery silently returns nothing. Generate vectors *from the SDK*, not
   from the documented formula.
3. **Zero-value invoke** validity (D12).
4. **Storage cost per slot** on current Starknet fee parameters (D9).
5. **Paymaster submitter decoupling** — confirmed for AVNU's private-swap flow; verify it holds
   for an arbitrary pool transaction carrying our `InvokeExternal`.
6. **Proving time** — ~29 s is STRK20's published figure for a payment-shaped transaction.
   Measure it for a transaction carrying a large message payload.
