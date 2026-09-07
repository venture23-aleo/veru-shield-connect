#!/usr/bin/env node
import {
  discoverChannels,
  flushOutbox,
  formatAge,
  fullHistory,
  listOutbox,
  pay,
  queueMessage,
  readMessages,
  sendMessage,
  syncNow,
  syncStatus,
} from "./commands.js";
import { configDir, loadConfig, saveConfig, type CliConfig } from "./config.js";
import { decodePaymentMemo, type Bucket } from "@strk20-messaging/sdk";

/**
 * A body sealed by `pay` carries its transfer inside the ciphertext, so it
 * renders as a payment; anything else is a plain message (payment.ts).
 */
function renderBody(body: Uint8Array): string {
  const payment = decodePaymentMemo(body);
  if (!payment) return `"${new TextDecoder().decode(body)}"`;
  const token = "0x" + payment.token.toString(16);
  return `${payment.amount} of ${token.slice(0, 10)}… · "${payment.text}"`;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--")) i++;
    else out.push(args[i]!);
  }
  return out;
}

const USAGE = `msg — encrypted messaging over the STRK20 privacy pool

  msg init --rpc <url> --helper <addr> --account <addr> [--mode direct|pool]
  msg channel add --label <name> --peer <addr> --key <channel key hex>
  msg channel discover              pull channel keys from the pool's scan (pool mode)
  msg channel list
  msg send --to <label|addr> [--pad 256|1024|4096] "text"
  msg queue --to <label|addr> [--pad 256|1024|4096] "text"
  msg outbox
  msg flush [--max N]
  msg pay --to <label|addr> --token <addr> --amount <wei> --memo "text"
  msg read
  msg sync [--full]                 rebuild history by walking all channels
  msg history [--channel <label>]   full cached history (run sync first)
  msg status                        sync watermark: block reached, message count

Config lives in ${configDir()} (override with STRK20_MSG_HOME).
Private key: env STRK20_MSG_PRIVATE_KEY, or account.privateKey in config.json.`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "init": {
      const rpc = flag(args, "rpc");
      const helper = flag(args, "helper");
      const account = flag(args, "account");
      if (!rpc || !helper || !account) {
        console.error("init needs --rpc, --helper, --account");
        return 2;
      }
      const cfg: CliConfig = {
        rpcUrl: rpc,
        helperAddress: helper,
        mode: (flag(args, "mode") as CliConfig["mode"]) ?? "pool",
        account: { address: account },
        channels: [],
      };
      saveConfig(cfg);
      console.log(`wrote ${configDir()}/config.json (mode: ${cfg.mode})`);
      return 0;
    }

    case "channel": {
      const [sub] = positional(args);
      const cfg = loadConfig();
      if (sub === "add") {
        const label = flag(args, "label");
        const peer = flag(args, "peer");
        const key = flag(args, "key");
        if (!label || !peer || !key) {
          console.error("channel add needs --label, --peer, --key");
          return 2;
        }
        cfg.channels = cfg.channels.filter((c) => c.label !== label);
        cfg.channels.push({ label, peer, channelKey: key });
        saveConfig(cfg);
        console.log(`channel "${label}" -> ${peer} added`);
        return 0;
      }
      if (sub === "discover") {
        const { added, known } = await discoverChannels({ log: (l) => console.log(l) });
        console.log(
          added === 0
            ? `no new channels (${known} known)`
            : `${added} channel(s) added (${known} known)`
        );
        return 0;
      }
      if (sub === "list") {
        for (const c of cfg.channels) {
          const how = c.discovered ? "discovered" : "manual";
          const dir = c.direction ? ` ${c.direction}` : "";
          console.log(`${c.label}\t${c.peer}\tkey: [redacted]\t(${how}${dir})`);
        }
        if (cfg.channels.length === 0) console.log("(no channels)");
        return 0;
      }
      console.error("unknown channel subcommand; use add, discover or list");
      return 2;
    }

    case "send": {
      const to = flag(args, "to");
      const pad = flag(args, "pad");
      const [text] = positional(args);
      if (!to || text === undefined) {
        console.error('send needs --to and the message text: msg send --to bob "hello"');
        return 2;
      }
      await sendMessage(to, text, {
        padTo: pad ? (Number(pad) as Bucket) : undefined,
        log: (l) => console.log(l),
      });
      return 0;
    }

    case "queue": {
      const to = flag(args, "to");
      const pad = flag(args, "pad");
      const [text] = positional(args);
      if (!to || text === undefined) {
        console.error('queue needs --to and the message text: msg queue --to bob "hello"');
        return 2;
      }
      const entry = queueMessage(to, text, pad ? (Number(pad) as Bucket) : undefined);
      console.log(`queued ${entry.id} · ${to}`);
      return 0;
    }

    case "outbox": {
      const items = listOutbox();
      if (items.length === 0) {
        console.log("outbox empty");
        return 0;
      }
      const queued = items.filter((i) => i.entry.status === "queued");
      for (const { entry, tier } of items) {
        const tail = entry.txHash ? ` ${entry.txHash.slice(0, 12)}…` : "";
        console.log(`${entry.status.padEnd(9)} ${entry.to.padEnd(12)} ${tier} B tier${tail}`);
      }
      if (queued.length > 0) {
        console.log(`\n${queued.length} message(s) queued · one transaction on flush`);
      }
      return 0;
    }

    case "flush": {
      const max = flag(args, "max");
      const report = await flushOutbox({
        max: max ? Number(max) : undefined,
        log: (l) => console.log(l),
      });
      console.log(
        report.flushed === 0
          ? "nothing to flush"
          : `flushed ${report.flushed} message(s) in ${report.transactions.length} transaction(s)`
      );
      return 0;
    }

    case "pay": {
      const to = flag(args, "to");
      const token = flag(args, "token");
      const amount = flag(args, "amount");
      const memo = flag(args, "memo");
      if (!to || !token || !amount || !memo) {
        console.error("pay needs --to, --token, --amount, --memo");
        return 2;
      }
      await pay(to, token, BigInt(amount), memo, { log: (l) => console.log(l) });
      return 0;
    }

    case "sync": {
      const report = await syncNow({
        full: args.includes("--full"),
        log: (l) => console.log(l),
      });
      void report;
      return 0;
    }

    case "history": {
      const records = fullHistory(flag(args, "channel"));
      if (records.length === 0) {
        console.log("no history — run: msg sync");
        return 0;
      }
      let n = 0;
      for (const r of records) {
        n++;
        const body = new Uint8Array(Buffer.from(r.bodyBase64, "base64"));
        console.log(`[${n}] from ${r.sender} · ${formatAge(BigInt(r.timestamp))} · ${renderBody(body)}`);
      }
      return 0;
    }

    case "status": {
      const s = syncStatus();
      if (s.syncedToBlock === null) {
        console.log("never synced — run: msg sync");
        return 0;
      }
      const age = s.updatedAt ? `${Math.round((Date.now() - s.updatedAt) / 1000)} s ago` : "";
      console.log(`synced to block ${s.syncedToBlock} · ${s.totalMessages} message(s) · ${age}`);
      return 0;
    }

    case "read": {
      const results = await readMessages();
      if (results.length === 0) {
        console.log("no new messages");
        return 0;
      }
      let n = 0;
      for (const r of results) {
        for (const m of r.messages) {
          n++;
          const sender = "0x" + m.frame.sender.toString(16);
          console.log(
            `[${n}] from ${sender} · ${formatAge(m.frame.timestamp)} · ${renderBody(m.frame.body)}`
          );
        }
      }
      return 0;
    }

    default:
      console.log(USAGE);
      return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
);
