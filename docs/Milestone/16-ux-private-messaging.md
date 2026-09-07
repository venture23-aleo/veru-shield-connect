# UX Design: Private Messaging on STRK20

> Product UX source for the web client. Architecture constraints from
> [01-overview.md](01-overview.md) and [03-architecture.md](03-architecture.md)
> must shape the UI — not be papered over.
>
> Implemented in `apps/web` as of the modern frontend pass: splash → compliance
> (scroll + acks) → viewing key → proving/submission defaults → channels with
> honest outbox proving. Payment-memo settle and live paymaster degradation are
> UI-scaffolded where noted; full wire-up follows pool integration.

This is not a generic chat UI. Three system properties must shape the design:

1. **~29s proving latency per send** — the dominant cost in the system.
2. **One `InvokeExternal` per transaction** — memo + transfer is atomic, but memo + other pool action is not.
3. **Auditor key escrow** — a real compliance limit on anonymity that must be disclosed, not discovered.

Good UX here means "honest about physics and policy," not "hide the wait and hope."

## Personas

| Persona | Job to be done | What breaks trust for them |
|---|---|---|
| Privacy-conscious sender | Send a message no one can link to them | Any UI that implies "fully anonymous" without the auditor caveat |
| OTC/escrow negotiator | Negotiate + settle in one atomic action | A memo that isn't provably tied to the transfer |
| Everyday payer | Attach a note to a payment | Confusion about why sending takes 30 seconds |

## Onboarding

```
Splash (logo)
   → Compliance disclosure (scroll-to-bottom + explicit checkboxes)
   → Viewing key (SetViewingKey immutable — one-time)
   → Defaults: paymaster vs direct · hosted vs self-hosted proving
   → Channel list
```

Do not use the word "anonymous" unqualified. Prefer: sender/recipient identity hidden from other pool participants and observers, with the auditor exception footnoted.

## Send flow

Optimistic bubbles with status chips: Encrypting → Generating proof → Submitting → Confirmed (Failed — retry). Composer stays open during proving. Cancel only before submission. Outbox remains the batch control.

## Settings trade-offs

Proving (hosted vs self) and submission (paymaster vs direct) are consequential choices with plain-language trade-offs — also available as a per-send toggle on the outbox bar.
