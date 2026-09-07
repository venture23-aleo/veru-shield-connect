# 07 — Discovery

Discovery has two halves, and they currently have different answers.

| Half | Needs an indexer? |
| --- | --- |
| **Message payloads** — walking our helper's slots | **No.** Plain `starknet_getStorageAt`; we control this read path entirely. |
| **Channel discovery** — finding who has opened a channel to you | **Yes, today.** See below. |

The previous revision specified an indexer service, a Postgres schema and bucketed prefix
queries *of our own*. That is deleted — we build no indexer. But the claim that none is
required overall was wrong, and this section corrects it.

## Channel discovery needs an indexer today

The Privacy SDK ships two discovery backends:

| Provider | Backend | Status |
| --- | --- | --- |
| `IndexerDiscoveryProvider` | HTTP discovery service | The default. Pagination and reorg repair handled server-side. |
| `ContractDiscoveryProvider` | Pool contract over Starknet RPC | **Exists in source but is not exported** from the published package; the `exports` map blocks deep paths, so importing it fails outright. |

So until that export lands, `transfers.discoverChannels(...)` requires a discovery service.
Track [starkware-libs/starknet-privacy](https://github.com/starkware-libs/starknet-privacy).

**Mitigate what you can now:** construct the provider directly with OHTTP envelope encryption,
which hides the client's IP from the discovery service.

```ts
new IndexerDiscoveryProvider(url, poolAddress, { ohttp: true })
```

This should be the default in our SDK extension, not an option.

## The scan

```
channels ← Privacy SDK channel scan          // inherited, unchanged
for each channel:
    index ← cached lastSeenIndex (default 0)
    loop:
        slot = h(MSG_ID_TAG, channel_key, index)
        value = starknet_getStorageAt(helper, slot)
        if value is empty: break
        decrypt, verify tag, index++
```

Three inherited properties make this work:

**Density.** Indices are sequential with no gaps, so the first empty slot is a sound
termination condition. This is why the helper must reject writes to an occupied slot rather
than skipping — a gap would silently truncate every future scan.

**Derivation.** Slot addresses come from the channel key, so without it they are
indistinguishable from random storage. An observer watching the helper's storage sees writes to
scattered slots with no structure.

**Locality.** Cost is proportional to your own channels and messages. A pool with millions of
messages costs you no more to scan than a quiet one.

## Why no indexer is required

Correctness needs only an RPC URL. That matters more than convenience: it means there is no
service whose availability gates message delivery, no operator who observes query patterns, and
no trust assumption to document.

An indexer remains **optional**, purely as a latency optimisation:

- Batch many slot reads into one response, avoiding a round trip per index.
- Push notifications on new writes rather than polling.
- Serve mobile clients that cannot afford a chatty scan.

If one is built, it should hold **no keys**, exactly as before — it caches ciphertext keyed by
slot address, and clients verify what they get by decrypting. A tampered or withheld payload
fails its Poly1305 check or simply looks like an empty slot, so an indexer can degrade
availability but never confidentiality or integrity.

Query privacy is worth a note: a client asking an indexer for specific slot addresses reveals
its interest set to that operator. Prefix bucketing solves it the same way it would have
before, and self-hosting or plain RPC avoids it entirely. Because the RPC path is always
available, this is a preference rather than a design constraint.

## Retention

Not our decision. Pool and helper storage is WriteOnce and permanent — messages persist as long
as Starknet does. There is no retention window to design and no cold-storage policy to write.

The consequence runs the other way: **messages cannot be deleted.** The UI must not imply
otherwise, and users should be told before their first send.
