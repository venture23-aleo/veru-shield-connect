import {
  encodePaymentMemo,
  privacyInvokeCalldata,
  seal,
  tierOf,
  type Bucket,
  type OutboxEntry,
  type Sealed,
} from "@strk20-messaging/sdk";
import { Account, RpcProvider } from "starknet";
import { discoverChannelsFromPool } from "./channels.js";
import {
  loadConfig,
  loadCursors,
  privateKey,
  saveConfig,
  saveCursors,
  type ChannelConfig,
  type CliConfig,
} from "./config.js";
import { HelperClient } from "./helper.js";
import { fileOutbox } from "./outboxStore.js";
import { poolSend, type PoolTransfer } from "./pool.js";
import { submitWithResilience } from "./resilience.js";
import { submitDirect } from "./tail.js";
import { nextFreeIndex, walkChannel, type FoundMessage } from "./walk.js";

export interface SendResult {
  channel: ChannelConfig;
  index: number;
  bucket: number;
  txHash: string;
}

function clients(cfg: CliConfig) {
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const helper = new HelperClient(provider, cfg.helperAddress);
  return { provider, helper };
}

function accountOf(cfg: CliConfig, provider: RpcProvider): Account {
  return new Account({
    provider,
    address: cfg.account.address,
    signer: privateKey(cfg),
  });
}

export function resolveChannel(cfg: CliConfig, to: string): ChannelConfig {
  const ch = cfg.channels.find((c) => c.label === to || c.peer.toLowerCase() === to.toLowerCase());
  if (!ch) {
    throw new Error(
      `no channel for "${to}" — add one: msg channel add --label <name> --peer <addr> --key <channel key>`
    );
  }
  return ch;
}

export async function sendMessage(
  to: string,
  text: string,
  opts: { padTo?: Bucket; log?: (line: string) => void } = {}
): Promise<SendResult> {
  const log = opts.log ?? (() => {});
  const cfg = loadConfig();
  const { provider, helper } = clients(cfg);
  const account = accountOf(cfg, provider);
  const channel = resolveChannel(cfg, to);
  const channelKey = BigInt(channel.channelKey);

  const cursors = loadCursors();
  const index = await nextFreeIndex(helper, channelKey, cursors[channel.channelKey] ?? 0);

  const sealed = seal({
    channelKey,
    index,
    sender: BigInt(cfg.account.address),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    body: new TextEncoder().encode(text),
    padTo: opts.padTo,
  });
  log(`queued · ${channel.label} · index ${index} · ${sealed.bucket} B tier`);

  let txHash: string;
  if (cfg.mode === "direct") {
    log("submitting (direct — dev mode, submitter visible)…");
    const res = await submitDirect(
      account,
      provider,
      [
        {
          contractAddress: cfg.helperAddress,
          entrypoint: "privacy_invoke",
          calldata: privacyInvokeCalldata([sealed]),
        },
      ],
      { onSubmitted: (h) => log(`submitted ${h}`) }
    );
    txHash = res.txHash;
  } else {
    const res = await poolSend(cfg, account, provider, [sealed], {
      onProving: () => log("proving… (~29 s)"),
      onSubmitted: (h) => log(`submitted ${h}`),
    }, { setupPeer: channel.peer });
    txHash = res.txHash;
    markSetupDone(cfg, channel);
  }
  log(`confirmed ${txHash}`);

  cursors[channel.channelKey] = index + 1;
  saveCursors(cursors);
  return { channel, index, bucket: sealed.bucket, txHash };
}

export interface ReadResult {
  channel: ChannelConfig;
  messages: FoundMessage[];
}

export async function readMessages(): Promise<ReadResult[]> {
  const cfg = loadConfig();
  const { helper } = clients(cfg);
  const cursors = loadCursors();
  const out: ReadResult[] = [];
  for (const channel of cfg.channels) {
    const channelKey = BigInt(channel.channelKey);
    const { messages, nextIndex } = await walkChannel(
      helper,
      channelKey,
      cursors[channel.channelKey] ?? 0
    );
    cursors[channel.channelKey] = nextIndex;
    if (messages.length > 0) out.push({ channel, messages });
  }
  saveCursors(cursors);
  return out;
}

// --- M4: outbox, batched flush, memo, resilience ---------------------------

export function queueMessage(to: string, text: string, padTo?: Bucket): OutboxEntry {
  const cfg = loadConfig();
  resolveChannel(cfg, to); // fail at queue time, not at flush time
  return fileOutbox().queue(to, text, padTo);
}

export function listOutbox(): { entry: OutboxEntry; tier: Bucket }[] {
  return fileOutbox()
    .list()
    .map((entry) => ({ entry, tier: tierOf(entry.body, entry.padTo) }));
}

export interface FlushReport {
  transactions: { txHash: string; count: number; channel: string }[];
  flushed: number;
}

interface SealedItem {
  entry: OutboxEntry;
  sealed: Sealed;
  index: number;
}

/**
 * The outbox flush: N queued messages per channel land in ONE privacy_invoke —
 * one transaction, one proof, one fee — through the resilience loop (retry with
 * proof-nonce invalidation, provingBlockId re-fetch per attempt and between
 * chained transactions, proof-size fallback to a smaller batch).
 */
export async function flushOutbox(
  opts: { max?: number; log?: (line: string) => void } = {}
): Promise<FlushReport> {
  const log = opts.log ?? (() => {});
  const cfg = loadConfig();
  const { provider, helper } = clients(cfg);
  const account = accountOf(cfg, provider);
  const outbox = fileOutbox();
  const cursors = loadCursors();
  const report: FlushReport = { transactions: [], flushed: 0 };

  const queued = outbox.take(opts.max ?? Infinity);
  if (queued.length === 0) {
    log("outbox empty");
    return report;
  }

  const byChannel = new Map<string, OutboxEntry[]>();
  for (const e of queued) {
    const ch = resolveChannel(cfg, e.to);
    byChannel.set(ch.channelKey, [...(byChannel.get(ch.channelKey) ?? []), e]);
  }

  for (const [channelKeyHex, entries] of byChannel) {
    const channelKey = BigInt(channelKeyHex);
    const label = resolveChannel(cfg, entries[0]!.to).label;

    const sealBatch = async (batch: OutboxEntry[]): Promise<SealedItem[]> => {
      const start = await nextFreeIndex(helper, channelKey, cursors[channelKeyHex] ?? 0);
      return batch.map((entry, k) => ({
        entry,
        index: start + k,
        sealed: seal({
          channelKey,
          index: start + k,
          sender: BigInt(cfg.account.address),
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
          body: new TextEncoder().encode(entry.body),
          padTo: entry.padTo,
        }),
      }));
    };

    let toSend = await sealBatch(entries);
    while (toSend.length > 0) {
      const ids = toSend.map((i) => i.entry.id);
      if (cfg.mode === "pool") outbox.mark(ids, "proving");
      log(`flushing ${toSend.length} message(s) to ${label} in one transaction…`);

      const outcome = await submitWithResilience(toSend, {
        fetchHead: () => provider.getBlockNumber(),
        invalidateProofNonceCache: () => {
          /* direct mode: nothing cached; pool mode invalidates inside poolSend's tail */
        },
        reseal: (batch) => sealBatch(batch.map((i) => i.entry)),
        onRetry: (reason, attempt, size) =>
          log(`retry ${attempt} (${reason}) — batch size ${size}`),
        submit: async (batch, provingBlockId) => {
          const events = {
            onSubmitted: (h: string) => {
              outbox.mark(
                batch.map((i) => i.entry.id),
                "submitted",
                { txHash: h }
              );
              log(`submitted ${h}`);
            },
          };
          if (cfg.mode === "direct") {
            return submitDirect(
              account,
              provider,
              [
                {
                  contractAddress: cfg.helperAddress,
                  entrypoint: "privacy_invoke",
                  calldata: privacyInvokeCalldata(batch.map((i) => i.sealed)),
                },
              ],
              events
            );
          }
          // Pool mode, first contact with this peer: open the channel in the
          // same transaction, or they can never discover the lane.
          const lane = cfg.channels.find((c) => c.channelKey === channelKeyHex);
          return poolSend(
            cfg,
            account,
            provider,
            batch.map((i) => i.sealed),
            { ...events, onProving: () => log("proving… (~29 s)") },
            { provingBlockId, setupPeer: lane?.peer }
          );
        },
      });

      const maxIndex = Math.max(...outcome.sent.map((i) => i.index));
      outbox.mark(
        outcome.sent.map((i) => i.entry.id),
        "confirmed",
        { txHash: outcome.txHash, indices: new Map(outcome.sent.map((i) => [i.entry.id, i.index])) }
      );
      cursors[channelKeyHex] = maxIndex + 1;
      const openedLane = cfg.channels.find((c) => c.channelKey === channelKeyHex);
      if (openedLane) markSetupDone(cfg, openedLane);
      saveCursors(cursors);
      report.transactions.push({ txHash: outcome.txHash, count: outcome.sent.length, channel: label });
      report.flushed += outcome.sent.length;
      log(`confirmed ${outcome.txHash} (${outcome.sent.length} message(s))`);

      toSend = outcome.remaining; // chained tx; provingBlockId re-fetched by the loop
    }
  }
  return report;
}

/**
 * Memo riding a transfer, atomically: one transaction carrying both the token
 * transfer and the sealed memo. If the transfer reverts, the memo reverts with
 * it — there is no state in which one lands without the other.
 */
export async function pay(
  to: string,
  token: string,
  amount: bigint,
  memoText: string,
  opts: { log?: (line: string) => void } = {}
): Promise<{ txHash: string; index: number }> {
  const log = opts.log ?? (() => {});
  const cfg = loadConfig();
  const { provider, helper } = clients(cfg);
  const account = accountOf(cfg, provider);
  const channel = resolveChannel(cfg, to);
  const channelKey = BigInt(channel.channelKey);
  const cursors = loadCursors();

  const index = await nextFreeIndex(helper, channelKey, cursors[channel.channelKey] ?? 0);
  const sealed = seal({
    channelKey,
    index,
    sender: BigInt(cfg.account.address),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    // The value details ride inside the ciphertext: the recipient cannot
    // pair a memo with a note from chain state (encrypted amount, recipient in
    // the proof), so the sender — who knows both — writes the pairing in.
    body: encodePaymentMemo(BigInt(token), amount, memoText),
  });
  log(`memo · ${channel.label} · index ${index} · transfer ${amount} of ${token.slice(0, 10)}…`);

  const transfer: PoolTransfer = { token, recipient: channel.peer, amount };
  let txHash: string;
  if (cfg.mode === "direct") {
    // Public ERC-20 transfer + memo in one multicall — atomic by Starknet
    // account semantics. (Pool mode makes the transfer private too.)
    const res = await submitDirect(
      account,
      provider,
      [
        {
          contractAddress: token,
          entrypoint: "transfer",
          calldata: [
            channel.peer,
            "0x" + (amount & ((1n << 128n) - 1n)).toString(16),
            "0x" + (amount >> 128n).toString(16),
          ],
        },
        {
          contractAddress: cfg.helperAddress,
          entrypoint: "privacy_invoke",
          calldata: privacyInvokeCalldata([sealed]),
        },
      ],
      { onSubmitted: (h) => log(`submitted ${h}`) }
    );
    txHash = res.txHash;
  } else {
    const res = await poolSend(cfg, account, provider, [sealed], {
      onProving: () => log("proving… (~29 s)"),
      onSubmitted: (h) => log(`submitted ${h}`),
    }, { transfer });
    txHash = res.txHash;
  }
  log(`confirmed ${txHash}`);
  cursors[channel.channelKey] = index + 1;
  saveCursors(cursors);
  return { txHash, index };
}

// --- M5: sync, history, sync-state reporting -------------------------------

import { SyncEngine, type HistoryRecord, type SlotReader } from "@strk20-messaging/sdk";
import { FileSyncStore } from "./syncStore.js";

function slotReader(helper: HelperClient, provider: RpcProvider): SlotReader {
  return {
    slotLens: (ids) => helper.slotLens(ids),
    slots: (id) => helper.slots(id),
    blockNumber: () => provider.getBlockNumber(),
  };
}

function syncEngine(cfg: CliConfig): SyncEngine {
  const { provider, helper } = clients(cfg);
  return new SyncEngine(slotReader(helper, provider), new FileSyncStore());
}

/**
 * Reconstruct history by walking every configured channel. `full` rescans from
 * index 0 — with a fresh config dir this rebuilds everything the viewing key's
 * channels ever received, from chain state alone.
 */
/**
 * Merge the pool's channel scan into the config. This is how an INCOMING
 * channel becomes readable at all: only the sender can derive the key, so
 * until the scan decrypts it for us the messages already in helper storage are
 * addressed to slots we cannot compute (M0 § S4).
 *
 * Hand-added channels are left alone — a discovered key never silently
 * overwrites one the user configured.
 */
export async function discoverChannels(
  opts: { log?: (line: string) => void } = {}
): Promise<{ added: number; known: number }> {
  const log = opts.log ?? (() => {});
  const cfg = loadConfig();
  if (cfg.mode !== "pool") {
    throw new Error("channel discovery needs mode 'pool' — direct mode has no channel scan");
  }
  const { channels } = await discoverChannelsFromPool(cfg);
  let added = 0;
  for (const found of channels) {
    const existing = cfg.channels.find(
      (c) => c.channelKey.toLowerCase() === found.channelKey.toLowerCase()
    );
    if (existing) {
      existing.direction ??= found.direction;
      continue;
    }
    const label = labelForPeer(cfg, found.peer);
    cfg.channels.push({
      label,
      peer: found.peer,
      channelKey: found.channelKey,
      direction: found.direction,
      discovered: true,
    });
    added++;
    log(`  + ${label} · ${found.direction === "in" ? "incoming" : "outgoing"} · ${found.peer.slice(0, 12)}…`);
  }
  if (added > 0) saveConfig(cfg);
  return { added, known: cfg.channels.length };
}

/** A stable, human-usable label for a peer we have never seen named. */
function labelForPeer(cfg: CliConfig, peer: string): string {
  const named = cfg.channels.find((c) => c.peer.toLowerCase() === peer.toLowerCase());
  if (named) return named.label;
  const short = `${peer.slice(0, 6)}…${peer.slice(-4)}`;
  let label = short;
  for (let n = 2; cfg.channels.some((c) => c.label === label); n++) label = `${short}#${n}`;
  return label;
}

export async function syncNow(
  opts: { full?: boolean; log?: (line: string) => void } = {}
): Promise<{ syncedToBlock: number; found: number; totalMessages: number }> {
  const log = opts.log ?? (() => {});
  let cfg = loadConfig();
  if (cfg.mode === "pool" && cfg.pool?.discoveryUrl) {
    // Best effort: a discovery outage must not stop us re-scanning the
    // channels we already know.
    try {
      const { added } = await discoverChannels({ log });
      if (added > 0) {
        log(`discovered ${added} new channel(s)`);
        cfg = loadConfig();
      }
    } catch (err) {
      log(`channel discovery skipped: ${(err as Error).message}`);
    }
  }
  const engine = syncEngine(cfg);
  const result = await engine.sync(
    cfg.channels.map((c) => c.channelKey),
    {
      fromScratch: opts.full,
      onWindow: (p) => log(`  ${labelFor(cfg, p.channelKey)} · scanned to index ${p.scannedTo} · ${p.found} found`),
    }
  );
  log(`synced to block ${result.syncedToBlock} · ${result.totalMessages} message(s) known`);
  return result;
}

export function syncStatus(): {
  syncedToBlock: number | null;
  updatedAt: number | null;
  totalMessages: number;
} {
  return syncEngine(loadConfig()).status();
}

export function fullHistory(channelLabel?: string): HistoryRecord[] {
  const cfg = loadConfig();
  const key = channelLabel ? resolveChannel(cfg, channelLabel).channelKey : undefined;
  return syncEngine(cfg).history(key);
}

/** Pool mode: remember that our channel to this peer is open, so later sends skip `setup`. */
function markSetupDone(cfg: CliConfig, channel: ChannelConfig): void {
  if (cfg.mode !== "pool" || channel.setupDone) return;
  channel.setupDone = true;
  saveConfig(cfg);
}

function labelFor(cfg: CliConfig, channelKey: string): string {
  return cfg.channels.find((c) => c.channelKey === channelKey)?.label ?? channelKey.slice(0, 10);
}

export function formatAge(timestamp: bigint): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
