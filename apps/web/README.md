# STRK20 Messages — the M6 browser client

The client shell: something a non-technical person can use. Browser app, as decided by M0/S2
(the Privacy SDK bundles into Vite; our crypto core is noble/scure-only and browser-safe).

```shell
pnpm --filter @strk20-messaging/web dev      # http://localhost:5173
pnpm --filter @strk20-messaging/web build
pnpm --filter @strk20-messaging/web test
```

## Modes

| Mode | What it is |
| --- | --- |
| **demo** (default) | A simulated pool in localStorage: real encryption, real WriteOnce slot semantics, the real ~29 s proving latency (adjustable in settings, honest by default), a peer registry for the unregistered-recipient flow, and a demo counterparty who replies. This is the walkthrough build for the "watch someone use it" exit test. |
| **direct** | A real helper over RPC — the CLI's dev mode, in the browser ([src/lib/backend.ts](src/lib/backend.ts)). Real chain, **nothing private**: you call the helper yourself, and only the account the helper was pinned to can write. |
| **pool** | Through the STRK20 pool — Arch 1 ([docs/16](../../docs/16-arch1-plan.md)): **you pay from your own account and are public; who you pay and how much are not.** A payment and its memo travel in one transaction ([src/lib/poolBackend.ts](src/lib/poolBackend.ts)). See below. |

## Pool mode

The Privacy SDK is not on npm, so the app takes a **built** `starknet-privacy` checkout from
the environment at build/dev time, like the CLI's `config.pool.sdkPath`:

```shell
P=~/.cache/scarb/registry/git/checkouts/starknet-privacy-*/bc75e4b   # the one Scarb already vendors
(cd $P/sdk && npm ci && npm run build)   # TS SDK
(cd $P && scarb build -p privacy)        # pool artifacts the local devnet deploys
(cd contracts && scarb build)            # our helper
```

Built without `STARKNET_PRIVACY`, the app still builds and demo/direct work; choosing Pool
says what is missing rather than failing later ([vite.config.ts](vite.config.ts)).

**Test it locally, end to end, against the real pool contract** (mock proving — the browser
runs the SDK's own mock prover and reads discovery straight from the pool over RPC):

```shell
pnpm run web:devnet   # devnet + real pool + our helper, alice & bob seeded
pnpm run web          # the app, with the SDK bundled
```

Both default to the checkout Scarb vendors (the `$P` above) once its SDK is built; set
`STARKNET_PRIVACY=<checkout>` only to point at a different one. Restart the dev server if you
change it — the SDK is resolved at startup.

Settings → **Pool** → *paste local devnet env…* → paste the JSON block the first command
printed → Save. Open a second browser (or a private window) as the other account. Add the
other person by address, type a memo, **💸 pay** → the transfer and the memo confirm as one
transaction; on the other side, **↻ discover** finds the channel and the memo shows as a
payment. The same flow is asserted headlessly in
[test/pool.e2e.test.ts](test/pool.e2e.test.ts) (`pnpm --filter @strk20-messaging/web test:e2e`
with `STARKNET_PRIVACY` set).

**Sepolia — with your own prover.** There is no public proving endpoint, but the prover is a
published container and runs on a big machine ([docs/15 § B2](../../docs/15-testnet-runbook.md)):

```shell
sudo docker run -d --name strk20-prover -p 3000:3000 \
  -e RPC_URL=https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10 -e CHAIN_ID=SN_SEPOLIA \
  -e MAX_CONCURRENT_REQUESTS=2 -e PREFETCH_STATE=true -e CORS_ALLOW_ORIGIN=http://localhost:5173 \
  ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2
```

Settings → Pool → ⚡ Sepolia preset (helper, pool, carrier) → *Local devnet* **off** → Proving
service URL **`/prover`** — the dev server proxies it to the prover on its own machine
([vite.config.ts](vite.config.ts)), so it works even when the browser is on another computer
and only port 5173 is forwarded (`http://localhost:3000` also works when the browser is local)
→ **Test prover** → discovery indexer left **empty** (the pool contract is read over RPC) → your
funded account, key, and the viewing key you registered → Save. Two
honest limits: the prover sees the witness (it is *yours* now, which is the point of running
it); and **funds** — deposits need the operator's screening attestation, so a live *payment*
needs notes that reached you from inside the pool. Registration and, with the zero-amount
carrier, messages do not.

What pool mode changes in the UI, and why:

- **Pairing is the pool.** No invites, no address-derived lanes. Your lane *to* a contact is
  derived the moment they are registered (`h(TAG, you, your_sk, them, their_pk)` — verified
  equal to the channel the SDK opens); their lane *to you* exists only once they have written
  or paid you and discovery has found it — hence the *no inbound lane yet* badge.
- **Register first.** Sends bundle registration, but a send needs a *registered recipient* —
  so the first two people in a pool would wait for each other forever. The chrome shows
  **Register on the pool** (a registration-only transaction, 2 STRK on Sepolia) until your key
  is on the pool; do it on both sides, then add each other.
- **A first message opens the channel** (`setup` in the same transaction) so the other side
  can discover the key; a payment does that on its own. Either way, the **first** contact with
  a peer names them in clear calldata (the pool's `Append`) — [docs/02](../../docs/02-threat-model.md).
- **Message-only sends ride a zero-amount carrier note** to yourself — the pool sanctions it,
  so a message needs **no funds**. The web app applies the two-line SDK patch itself while
  bundling ([sdkPatch.ts](sdkPatch.ts), a Vite transform on the SDK's `compiler.js`), so any
  checkout works without `pnpm run sdk:patch`; the CLI still needs the script. An unpatched
  SDK would refuse the zero note ("Created note amount must be positive") and fall back to
  1 wei, which does need a spendable note.
- **The pool fee (2 STRK on Sepolia) is approved automatically** the first time — a separate
  transaction before the pool one, then not again for fifty.
- **Shield** (in the 💸 pay panel): public STRK → a private note, i.e. approve + a proven
  `Deposit`. Deposits are *screened* by the pool, so on Sepolia this proves through the
  **Screening prover URL** in Settings — the operator's — and reverts with
  `SCREENING_REQUIRED` without it. If the browser cannot call that prover directly, start the
  dev server with `SCREENING_PROVER_URL=https://… pnpm run web` and set the field to
  `/screening-prover` (same proxy trick as `/prover`). A fresh note matures for 10 blocks;
  the pay panel shows it as *maturing* until then. Locally the devnet harness screens with its own key, so
  shield → pay → discover runs end to end ([test/pool.e2e.test.ts](test/pool.e2e.test.ts)).
- **The viewing key is the identity.** It is what `SetViewingKey` registers on first use and
  what every note and channel derives from; the wrong key doesn't fail, it sees nothing.

## UI

The interface is the VeruShield Connect design from `feat/updated-frontend`, merged onto the
pool, payments and wallet work: Tailwind v4 (`@tailwindcss/vite`), Phosphor icons, a workspace
shell with a collapsible rail (Conversations · Privacy trade-offs · Compliance disclosure ·
Settings), a top status bar and footer that show the **real** connection (mode, network, block,
STRK balance, registration), a splash, and mobile list/thread switching.

Every number in the chrome is live state — nothing decorative. The trade-offs page reads the
current connection and says what is private (recipient after the first message, amount,
content) and what is public (the paying account, size, timing, the auditor's escrow).

Screens with dense forms — the connection editor, the pay / request / split panels, the wallet
onboarding — keep their original class names inside a `.legacy` container; `styles.css` maps
those names onto the design tokens, so they took the new look without a rewrite.

## Wallet mode (Ready)

Settings → **Wallet** → pick the Sepolia or mainnet preset → **Connect Ready**. The mainnet
preset points at the helper deployed 2026-09-07, `0x030a2a39…b3a6` (DEPLOYMENTS.md). The wallet
signs and proves through the STRK20 wallet API (`wallet_strk20InvokeTransaction`); no private
key or viewing key is pasted anywhere. Settings probes the wallet for STRK20 support and tells
you if the account still needs to shield once to register. Trade-offs and the method table are
in [docs/20](../../docs/20-wallet-mode.md).

**Ready X as signer, app as prover.** When the wallet's own STRK20 support is unavailable
(Sepolia answered `NOT_REGISTERED` to everything), pool mode can still be signed by Ready X:
the viewing key is derived from one wallet signature, the app's `/prover` proves, and each pool
transaction goes to the wallet with its proof attached. Onboarding → **Use Ready X as signer**,
or Settings → Pool → **Sign with Ready X instead of a key** ([docs/20 § Route B](../../docs/20-wallet-mode.md)).

## Payments in chat

Four value actions, all on the Arch 1 shape — details and privacy claims in
[docs/19](../../docs/19-payments-in-chat.md):

- **💸 send STRK** (thread) — amount in STRK, memo in the box; one transaction carries the
  private transfer and the `PAY1` memo. Pre-filled by tapping **Pay** on a request.
- **🧾 request** (thread) — a `REQ1` message through the ordinary outbox; the other side gets a
  Pay button, and their payment settles it as **✓ paid** (matched by token + amount, client-side).
- **💸 split / tip** (group) — pick members, an amount each: N private notes and one memo on your
  group lane in a single transaction ([`payMany`](src/lib/poolBackend.ts)).
- **✓ receipt** (recipient) — a received memo is checked against your unspent notes in the pool;
  the chain never links a memo to a note, so the recipient's client does.

Demo mode simulates the pool (100 STRK of notes, a counterparty who pays your requests) so the
same flow runs with zero setup.

## Where each M6 deliverable lives

- **Outbox interface, batch control** — [OutboxBar.tsx](src/ui/OutboxBar.tsx): "Outbox · N messages
  queued · ~29 s · cost · one transaction · [Send batch]". A control, not a spinner.
- **Explicit send states** — Queued → Proving (~29 s, visible progress) → Submitted → Confirmed
  chips, driven by the sdk Outbox state machine.
- **Tier preview + boundary warnings** — [costs.ts](src/lib/costs.ts) / compose footer:
  "N more bytes moves this to the 1 KiB tier (+$…)".
- **Sync indicator in the chrome** — [Chrome.tsx](src/ui/Chrome.tsx): "synced to block N · Xs ago",
  header not settings; click to sync.
- **Onboarding disclosures** — [Onboarding.tsx](src/ui/Onboarding.tsx): all three (auditor can
  read; messages permanent; "a message was sent" is public), each individually acknowledged,
  gate enforced. At onboarding, not in settings.
- **Thread view stitching** — [contacts.ts](src/lib/contacts.ts): the two directional lanes
  merged by timestamp with deterministic tie-breaks.
- **Unregistered-recipient flow** — [ThreadView.tsx](src/ui/ThreadView.tsx): hard stop at compose
  time with an explanation, an invite to copy, and re-check; demo mode can simulate the peer
  registering.
- **Key backup and restore** — [backup.ts](src/lib/backup.ts) + Settings (download/copy) +
  onboarding restore path. Backups hold keys and contacts only — history is rebuilt by sync
  (M5), which the tests prove.
- **No delete affordance anywhere** — by construction; the permanence disclosure says why.

## Groups

A group is one shared **group key**; every member writes on their own lane
(`laneKey = Poseidon(STRK20_GROUP_LANE:V1, groupKey, memberAddress)` — sdk `groupLaneKey`)
and reads everyone's, so concurrent senders never race for slots and seal/open/sync/the
helper are unchanged. Create under **+ group** (members one per line), share with
**copy group invite**, join by pasting it. Verified live on Sepolia: two browsers plus a
scripted third member in one thread, each message attributed to its lane's owner.

Honest edges, by construction: a joiner sees the **full history** (lanes walk from index 0,
storage is permanent); sender attribution is **cooperative** — every member can compute every
lane key, the same shared-secret trust model as pairwise; removing a member means a new group.
Direct-mode extra: the optional **messaging identity** field in Settings lets several browsers
share the one funded signer while staying distinct members (pool mode ignores it — there,
identity is the account).

## Verified by driving it

A Playwright script walked the whole flow headlessly (onboarding gate, contact add,
unregistered flow, tier warning, two-message batch through a real 29 s proving run, demo reply
arriving via sync, no-delete check) with zero console errors; screenshots confirmed each
screen. The human "watch someone who has never seen the CLI" session remains to be run — the
demo mode exists precisely so that session needs nothing but a browser.
