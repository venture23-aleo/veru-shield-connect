# 14 — Milestones

Eight milestones, two of which are **gates** — points where the project produces something that
actually runs rather than something that merely compiles.

Sizes are engineer-weeks assuming **one Cairo engineer and one TypeScript engineer working in
parallel**. Calendar time differs with team size; the *ordering* and the *dependencies* do not.

```
M0 ──┬── M1 ──┬── M3 ──┬── M4 ──┬── M6 ── M7
     │        │  GATE  │        │        GATE
     └── M2 ──┘        └── M5 ──┘
```

| | Milestone | Size | Depends on |
| --- | --- | --- | --- |
| **M0** | Feasibility spikes | 1 wk | — |
| **M1** | Crypto core + vectors | 1–2 wk | M0 |
| **M2** | Helper contract | 1–2 wk | M0 |
| **M3** | **First message end to end** | 1–2 wk | M1, M2 |
| **M4** | Batching, memo, resilience | 2 wk | M3 |
| **M5** | Discovery and sync | 1–2 wk | M3 |
| **M6** | Client shell | 3–4 wk | M4, M5 |
| **M7** | Hardening and Mainnet | 3–4 wk + audit | M6 |

---

## M0 — Feasibility spikes

**Goal:** kill the design now if it is going to die. No product code.

Four experiments, each a day or less:

| Spike | Question | Resolves |
| --- | --- | --- |
| **S1** | Does an invoke-only transaction (no token movement) simulate? `strk20PrepareInvoke(actions, true)` | [D12](09-open-decisions.md) |
| **S2** | Does the Privacy SDK bundle into a Vite app, or is the client Node-only? | [D13](12-client-and-ui.md) |
| **S3** | Sepolia storage cost for 256 B and 4 KiB payloads | [D9](09-open-decisions.md) |
| **S4** | Reproduce `channel_key` from the SDK; find the builder's generic `invoke()` signature | Verification list |

**Exit criteria** — a written decision record answering: is the pure-message path available;
Option A or Option B; storage or events for payloads; per-message cost and latency you would
put in front of a user.

**Risk: high, and deliberately front-loaded.** S1 failing means every message needs a dust
transfer. S2 failing decides the entire client architecture. Both are cheap here and expensive
in M6.

---

## M1 — Crypto core + vectors

**Goal:** every pure function, fully tested, with no chain dependency.

**Deliverables:** frozen `vectors/derivations.json` generated *from the SDK*, not from the
documented formula; `msgId` / `msgKey`; `seal` / `open` with ChaCha20-Poly1305; `packFelts` /
`unpackFelts`; padding buckets; framing.

**Exit criteria:** unit tests green; round-trip property tests (`open(seal(x)) == x`) across all
buckets and boundary lengths; a test asserting `key_i` uniqueness, since the all-zero nonce
depends on it; vectors reproduce byte-for-byte against the SDK.

**Risk: low.** This is the part of the system with no unknowns — which is exactly why it should
not be where the schedule goes.

---

## M2 — Helper contract

**Goal:** `message_anonymizer.cairo`, deployed to Sepolia.

**Deliverables:** the contract, `snforge` tests including the negative cases, a deployment
script, and a verified Sepolia address.

**Exit criteria:** all four negative tests pass — non-pool caller rejected, occupied slot
rejected, empty payload rejected, deposits span returned verbatim; a mock caller can write and
read back a payload; the contract is declared, deployed and verified on Sepolia.

**Runs in parallel with M1** once vectors are frozen. That is the entire reason vectors come
first.

**Risk: low–medium.** The contract is small; the risk is in matching the pool's expected
calldata and return shapes exactly.

---

## M3 — First message end to end · **GATE: ALPHA**

**Goal:** one message, sent from one machine, read on another, on Sepolia.

**Deliverables:** a Node CLI with `send` and `read`; the submission tail wrapped once; the
slot-walk discovery loop.

**Exit criteria — the real test of the whole design:**

```
machine A:  $ msg send --to 0xBOB "hello"
            → proving… submitted… confirmed 0x…

machine B:  $ msg read
            → [1] from 0xALICE · 2 min ago · "hello"
```

Plus: an observer inspecting that transaction sees the pool and helper addresses, a payload
size, and a timestamp — and neither party's address, no recipient, no content.

**This is the milestone that proves the project.** Everything before it is preparation;
everything after it is scale, resilience and polish. If the architecture is wrong, it is wrong
here, and M3 is deliberately placed early and cheap so that failure is survivable.

---

## M4 — Batching, memo, resilience

**Goal:** the transaction shapes the product actually needs.

**Deliverables:** outbox that accumulates and flushes; N messages in one `InvokeExternal`;
memo riding a transfer atomically in one action batch; retry with
`invalidateProofNonceCache()`; `provingBlockId` re-fetch between chained transactions;
proof-size fallback to a smaller batch.

**Exit criteria:** 8 messages land in one transaction with one proof and one fee; a
memo-plus-transfer settles atomically, and reverting the transfer also reverts the memo; a
forced submission failure recovers cleanly instead of looping on a rejected proof.

**Risk: medium.** Proof-size limits under large batches are a known unknown — the batch size
that actually works has to be found empirically.

---

## M5 — Discovery and sync

**Goal:** a client that recovers everything from the viewing key alone.

**Deliverables:** channel discovery wired to `discoverChannels` with cursors; OHTTP enabled by
default; per-channel index cache; batched slot reads; sync-state reporting; resumable scan.

**Exit criteria:** a client with **no local state** reconstructs full message history from the
viewing key; a client interrupted mid-scan resumes without gaps or duplicates; sync state
reports the block it has reached.

**Runs in parallel with M4.**

**Risk: medium.** Depends on the discovery service, and today on an indexer, since
`ContractDiscoveryProvider` is not yet exported ([07-discovery.md](07-discovery.md)).

---

## M6 — Client shell

**Goal:** something a non-technical person can use.

**Shape is decided by M0/S2** — a browser app if the SDK bundles, otherwise a desktop app with
a Node sidecar or a local daemon behind a localhost UI.

**Deliverables:** the outbox interface; explicit send states (`Draft → Queued → Proving →
Submitted → Confirmed`); batch control showing count, time and cost; padding-tier cost preview
with boundary warnings; sync indicator in the chrome; onboarding disclosures; thread view
stitching the two directional channels; unregistered-recipient flow; key backup and restore.

**Exit criteria:** a user who has never seen the CLI can register, send, receive and understand
what is public — verified by watching someone do it, not by asserting it. No delete affordance
anywhere. All three disclosures appear at onboarding, not in settings.

**Risk: medium–high**, and mostly product risk rather than technical. This is where ~29 s
proving either works as a designed-for constraint or does not.

---

## M7 — Hardening and Mainnet · **GATE: PRODUCTION**

**Goal:** ship it.

**Deliverables:** external audit of the SDK crypto and the helper contract, in that order;
adversarial metadata review against [02-threat-model.md](02-threat-model.md); a documented
auditability position ([D10](09-open-decisions.md)) in user-facing copy; Mainnet deployment;
incident and key-rotation runbooks.

**Exit criteria:** audit findings closed; the anonymity-set size is stated honestly in the
product; Mainnet helper deployed and verified.

**Risk: audit scheduling is the long pole.** Book it during M5, not after M6.

---

## How to read this plan

**Two gates, two different kinds of confidence.** M3 proves the architecture works. M6 proves
the product is usable. They fail for different reasons and need different responses — an M3
failure is a redesign, an M6 failure is a rethink of the product shape.

**M0 is not optional and is not a formality.** Four documented claims underpin everything;
two can force a redesign. A week here saves a month later.

**The parallel pairs are real.** M1‖M2 and M4‖M5 are genuinely independent given frozen
vectors and a working M3, so a two-person team is not serialised.

**Effort is back-loaded, and correctly so.** M0–M3 is roughly a quarter of the work and
retires most of the risk. M6–M7 is roughly half the work and retires almost none — it is
polish, audit and product. Resist the temptation to reverse that ordering by starting on the
client early; a beautiful client on a broken assumption is the expensive failure mode here.
