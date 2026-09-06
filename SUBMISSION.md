# VeruShield Connect

> End-to-end encrypted messaging where the blockchain is the mailbox — no servers, no metadata, permanent.

**Team**: Venture23 Inc.

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
- 📦 Outbox batching — many messages, one transaction, one fee
- 🔑 Backup = just your keys; full message history rebuilds from the chain alone
- 🌐 Web app + CLI

## Proof it works

- Deployed contract: [`0x06409a…e032`](https://sepolia.voyager.online/contract/0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032)
- A real message on-chain: [`0x2224a3…f395`](https://sepolia.voyager.online/tx/0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395)
- ~$0.006 per message · 85+ tests green · two browsers exchanged messages via chain state only

## Tech

Cairo contract (WriteOnce storage) · TypeScript SDK (ChaCha20-Poly1305 + Poseidon) · React web app · CLI

## Run it

```bash
pnpm install && pnpm -r build && pnpm run web   # demo mode — zero setup
```
