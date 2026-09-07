# 08 — Submission

> **Status (2026-09-07): not the v1 path.** v1 ships the *public payer* shape
> ([16-arch1-plan.md](16-arch1-plan.md)) — the payer submits from their own account, no
> paymaster. Everything below stays correct as the route back to sender anonymity: the pool's
> `apply_actions` is callable by any address and authorised by proof, so a relay needs no
> contract change. Nothing in this document is wired into the code today.

The previous revision devoted this section to a relayer network that had to be designed, built,
funded, and decentralised, on the grounds that without it there was no sender anonymity.

STRK20 supplies the same property two ways, and neither requires us to operate infrastructure.

## Where anonymity actually comes from

**At the helper: the pool is the caller.** During `InvokeExternal`, the pool calls
`privacy_invoke`. Inside the helper, `get_caller_address()` is the pool for every message from
every user. The helper cannot distinguish its callers even in principle, because it never sees
them. Observers see the pool interacting with the helper, not who initiated.

**At the transaction: a paymaster submits.** Starknet's account model still puts a public
`account_contract_address` on every transaction — that part of the earlier analysis holds. The
answer is that a paymaster relays it. AVNU's private-swap flow documents exactly this: *"the
paymaster relays the transaction, so the submitting address is not the user's."*

**Underneath both: the proof.** Authorization is checked by account-abstraction signature
verification *inside* the proven virtual execution, not by the outer transaction's signature.
That is what makes third-party submission sound: the submitter proves nothing about themselves
and cannot alter the actions, since the pool verifies that the proven message hash matches the
submitted actions exactly.

## Proving latency is the UX

**~29 s per transaction** on a 12-core / 46 GiB machine, machine-dependent. This is the single
largest practical constraint on the product, and it is inherited rather than chosen.

Combined with **one `InvokeExternal` per transaction**, it sets a hard shape:

- A message costs ~29 s of proving regardless of size.
- Three messages in one invoke also cost ~29 s.
- Three messages in three transactions cost ~87 s and three fees.

So the client is an **outbox that batches and flushes**, not a chat window that sends on enter.
Design the UI around that from the start; retrofitting batching onto a send-on-enter interface
is much harder than starting with it.

Three levers, in order of leverage: batch aggressively within one invoke; prove in the
background while the user keeps typing; self-host or provision a faster prover if latency
remains unacceptable.

## Choosing a paymaster

| Option | Trade-off |
| --- | --- |
| **AVNU paymaster** | Documented, in production for private swaps. Adds a dependency on a third party for liveness. |
| **Self-hosted paymaster** | Full control; you fund gas and become the visible submitter for all your users, which is itself a fine anonymity property. |
| **Direct submission** | No dependency. The user's own address is the public submitter — the pool's internal privacy still holds, but the transaction is linkable to them. |

Note the operational detail from AVNU's docs: the `sponsored_private` fee mode needs an API key
that **must stay server-side**. A browser client should split the flow — build and submit from a
server endpoint, run only the proving step client-side with the user's wallet.

Direct submission must remain available as a liveness fallback, and must be an explicit choice
with a clear warning rather than a silent degradation.

## What each party can and cannot do

**The paymaster** cannot read messages (no keys), cannot alter them (the proof binds the
actions), and cannot forge them. It can refuse service, delay, and observe submitter IP and
timing. *Mitigations:* rotate paymasters, use Tor or a proxy, add send jitter.

**The prover backend**, if hosted, sees the witness — including the actions being proven.
This is a more sensitive position than the paymaster's and deserves more scrutiny than it
usually gets. Self-host for sensitive traffic.

**The pool** sees nothing it does not already see for payments.
