# Encrypted Messaging on STRK20

Architecture documentation for a metadata-resistant messaging layer built as an **anonymizer
contract** on the STRK20 privacy pool.

## Status

**Implemented; helper deployed on Sepolia.** The CLI, SDK, helper contract and browser client
are built and tested; pool mode — a private payment carrying an encrypted memo — is proven on
devnet against the real pool contract from both the CLI and the browser
([16](16-arch1-plan.md)). The pool-mode helper is live on Sepolia ([DEPLOYMENTS.md](../DEPLOYMENTS.md));
the first live send waits on a proving endpoint ([15 § B2](15-testnet-runbook.md)). This revision is written against STRK20 —
Starknet's deployed privacy pool — rather than against a hypothetical pool, which removed
roughly half of the originally planned work. Claims here are drawn from STRK20's public
documentation and were then verified against source in [14-m0-decision-record.md](14-m0-decision-record.md); remaining items needing confirmation are marked
throughout and collected in [09-open-decisions.md](09-open-decisions.md).

## Read in this order

| Doc | What it covers |
| --- | --- |
| [01-overview.md](01-overview.md) | What STRK20 already provides, and the narrow gap this project fills |
| [02-threat-model.md](02-threat-model.md) | Adversaries, what leaks, and the escrowed auditor key |
| [03-architecture.md](03-architecture.md) | Two components and the end-to-end flow |
| [04-cryptography.md](04-cryptography.md) | Inherited derivations, and the AEAD layer we add |
| [05-contracts.md](05-contracts.md) | `message_anonymizer.cairo` and the `privacy_invoke` contract |
| [06-sdk.md](06-sdk.md) | Privacy SDK extension and the discovery scan |
| [07-discovery.md](07-discovery.md) | Storage-derived message lookup; why no indexer is required |
| [08-submission.md](08-submission.md) | Paymasters, proving latency, and where anonymity comes from |
| [09-open-decisions.md](09-open-decisions.md) | What is resolved, what is newly open |
| [10-tech-stack.md](10-tech-stack.md) | Packages, versions, services, repo layout, footguns |
| [11-implementation.md](11-implementation.md) | Build order with the code the interfaces determine |
| [12-client-and-ui.md](12-client-and-ui.md) | The two client architectures, and the outbox interface |
| [13-milestones.md](13-milestones.md) | **Eight milestones with two shippable gates — start here to build** |
| [14-m0-decision-record.md](14-m0-decision-record.md) | M0 spike results: D9/D12 resolved, derivations verified, SDK bundles for browser |
| [15-testnet-runbook.md](15-testnet-runbook.md) | Sepolia checklist: direct-mode run today (Phase A), pool-mode blockers (Phase B) |
| [16-arch1-plan.md](16-arch1-plan.md) | **Public sender, private recipient — the shape v1 ships, and the work left to finish it** |
| [17-pool-mode-test-plan.md](17-pool-mode-test-plan.md) | Every pool-mode property to test, with what is automated, manual, missing, or blocked |
| [19-payments-in-chat.md](19-payments-in-chat.md) | Pay, request, split/tip and receipts inside a thread — formats, settlement, what stays private |
| [20-wallet-mode.md](20-wallet-mode.md) | Braavos / Ready through the STRK20 wallet API — no keys in the app, what it trades away |

## The one-paragraph version

Two STRK20 participants already share a **channel key**, derived by ECDH on the STARK curve
when either first pays the other. We reuse that key to address message slots the same way the
pool addresses note slots: `msg_id = h(MSG_ID_TAG, channel_key, index)`, dense and sequential,
written once. A message is sent by adding an `InvokeExternal` action to a pool transaction,
which makes the pool call our `message_anonymizer` helper — so the helper's caller is the
pool, not the author. **The payer submits their own transaction and is publicly visible**
([16-arch1-plan.md](16-arch1-plan.md)): what the design buys is a private *recipient* and a
private *amount*, not an anonymous sender. The recipient finds messages by walking derived
storage slots over plain RPC and decrypting locally. There is no relayer to build, no membership circuit to write, no
verifier to deploy, and no indexer required.
