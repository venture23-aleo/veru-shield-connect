# VeruShield Connect

> End-to-end encrypted messaging where the blockchain is the mailbox — no servers, no metadata, permanent.

**Team**: Venture23 Inc. · **License**: MIT ([LICENSE](LICENSE))

## How it works

The sender encrypts the message in the browser and writes the ciphertext into a smart
contract, at a storage slot only the two parties can compute. The receiver derives the
same slots, reads them from any public node, and decrypts locally. The two clients never
connect to each other — or to any server.

    sender                        Starknet                       receiver
    encrypt in browser   ─►   ciphertext stored on-chain   ◄─   poll & read slots
                              (permanent, unreadable)           decrypt locally 

## Features

- 💬 1-to-1 chat and group messaging (per-member encrypted lanes)
- 💸 Money in the chat, through the STRK20 pool: **pay** with a private memo in one transaction,
  **request** a payment (one-tap pay on the other side, settles as ✓ paid), **split / tip** a group
  (one private note per member, one proof), and **receipts** matched against your own pool notes
  ([docs/19](docs/19-payments-in-chat.md)). You pay publicly; who you paid and how much stay private.
- 📦 Outbox batching — many messages, one transaction, one fee
- 🔑 Backup = just your keys; full message history rebuilds from the chain alone
- 👛 Ready wallet mode through the STRK20 wallet API — the wallet proves and signs; no keys pasted (Braavos does not expose the API yet) ([docs/20](docs/20-wallet-mode.md))
- 🌐 Web app + CLI

## Proof it works

- **Mainnet** helper contract, `pool` pinned to the live STRK20 pool: [`0x030a2a…b3a6`](https://voyager.online/contract/0x030a2a39c47adba579c8fd07e7d9adbf5fe8f36b97da0b6ead884cae3a8bb3a6) (deploy tx [`0x07f381…b8e8`](https://voyager.online/tx/0x07f38182c93bd902e8d3830b86a4f1acc0be90f629ba396e7ea3a513ae9fb8e8), declare [`0x040534…b6f7`](https://voyager.online/tx/0x040534693d8cbb2f9d871d5f3195fcdbaa51892c01ebc49e68900d485c69b6f7))
- Sepolia helper, pool mode — `pool` pinned to the real STRK20 Sepolia pool: [`0x016f77…e0b6`](https://sepolia.voyager.online/contract/0x016f77a566ed28f2945e315f2de971b8f3e83a03b93340e8927a311277f6e0b6) (deploy tx [`0x0425af…537e`](https://sepolia.voyager.online/tx/0x0425af6dad2ce028c83918ce64feee9d0351f4cd8a83325a6b934eaf19e6537e))
- Dev-mode helper used for the measurements below: [`0x06409a…e032`](https://sepolia.voyager.online/contract/0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032)
- A real message on-chain: [`0x2224a3…f395`](https://sepolia.voyager.online/tx/0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395)
- ~$0.006 per message · 85+ tests green · two browsers exchanged messages via chain state only

## Tech

Cairo contract (WriteOnce storage) · TypeScript SDK (ChaCha20-Poly1305 + Poseidon) · React web app · CLI

## Run it

```bash
pnpm install && pnpm -r build && pnpm run web   # demo mode — zero setup
```
