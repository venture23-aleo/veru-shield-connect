import { viewingKey, type CliConfig } from "./config.js";
import { createTransfers } from "./poolClient.js";

// The OHTTP rule now lives with the SDK factory, so proving and discovery
// cannot drift apart. Re-exported: this is still the discovery-facing name.
export { discoveryOptions, type DiscoveryOptions } from "./poolClient.js";

export interface DiscoveredChannel {
  peer: string;
  channelKey: string;
  direction: "in" | "out";
}

/**
 * Channel discovery — the recipient's ONLY route to a channel key.
 *
 * Only the sender can *derive* `channel_key` (M0 § S4); the recipient obtains
 * it by decrypting the channel record during the pool's scan. Until this runs,
 * an incoming channel is invisible and its messages unreadable, however many
 * of them are sitting in helper storage.
 */
export async function discoverChannelsFromPool(
  cfg: CliConfig
): Promise<{ channels: DiscoveredChannel[]; timestamp: unknown }> {
  const vk = viewingKey(cfg); // fail here, with a useful message, not inside the SDK
  const { transfers, discovery } = await createTransfers(cfg);
  const me = BigInt(cfg.account.address);
  const hex = (v: bigint) => "0x" + v.toString(16);
  const channels: DiscoveredChannel[] = [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // Outgoing: `discoverChannels` enumerates OUR channels, keyed by recipient.
  // (Verified on devnet: it never returns incoming ones.)
  const out: any = await transfers.discoverChannels("all", {});
  for (const [addr, ch] of out?.channels?.entries?.() ?? []) {
    const peer = BigInt(addr);
    if (peer === me) continue; // the self-channel
    channels.push({ peer: hex(peer), channelKey: hex(BigInt(ch.key)), direction: "out" });
  }
  // Incoming: only the notes scan decrypts the channel infos filed under OUR
  // address (`get_channel_info(me, i)`) — keyed by sender, present whether or
  // not a note exists yet.
  const { cursor, timestamp }: any = await discovery.discoverNotes(me, vk, {});
  for (const [sender, ic] of cursor?.incomingChannels?.entries?.() ?? []) {
    const peer = BigInt(sender);
    if (peer === me) continue;
    channels.push({ peer: hex(peer), channelKey: hex(BigInt(ic.channelKey)), direction: "in" });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { channels, timestamp };
}
