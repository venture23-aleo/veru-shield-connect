import {
  Outbox,
  SyncEngine,
  devPairLane,
  emptySnapshot,
  encodePaymentMemo,
  encodePaymentRequest,
  decodePaymentRequest,
  seal,
  msgId,
  tierOf,
  type OutboxEntry,
  type OutboxStore,
  type Sealed,
  type SyncSnapshot,
  type SyncStore,
} from "@strk20-messaging/sdk";
import { DemoBackend, DirectBackend, type Backend } from "./backend.js";
import { PoolBackend } from "./poolBackend.js";
import { WalletBackend, typicalWalletSeconds } from "./walletBackend.js";
import { exportBackup, parseBackup } from "./backup.js";
import type { Contact } from "./contacts.js";
import { groupLanes, myLane, type Group, type GroupInvite, type GroupMember } from "./groups.js";

export type Mode = "demo" | "direct" | "pool" | "wallet";

export interface AppConfig {
  onboarded: boolean;
  mode: Mode;
  /**
   * Pool mode: the key registered on the pool (SetViewingKey, bundled into
   * the first transaction). Notes and channels are addressed by derivations
   * of it — the wrong key does not fail, it discovers nothing.
   */
  viewingKey: string;
  accountAddress: string;
  /** Honest by default; adjustable in settings for demos. */
  provingSeconds: number;
  /**
   * Demo-mode presentation of the real trade-off: a hosted prover sees the
   * witness, the app's own prover keeps it local; real modes are decided by
   * the connection (pool = app prover, wallet = the wallet proves).
   */
  provingMode?: "hosted" | "self";
  /** Presentation only: this app always submits from your own account (Arch 1); a paymaster would hide the payer. */
  submissionMode?: "paymaster" | "direct";
  rpcUrl?: string;
  helperAddress?: string;
  accountKey?: string;
  // -- pool mode (16-arch1-plan.md § W8) --
  poolAddress?: string;
  /** Local devnet: mock proving + contract discovery (scripts/pool-devnet.mjs). */
  poolLocal?: boolean;
  provingUrl?: string;
  discoveryUrl?: string;
  /** Token for the carrier note on message-only sends, and the default pay token. */
  carrierToken?: string;
  /** Submission endpoint for live networks (`/gateway` = dev-server proxy to StarkWare's gateway). */
  gatewayUrl?: string;
  /** The operator's screening-enabled prover, for deposits; empty = same prover as everything else. */
  screeningProvingUrl?: string;
  /**
   * The injected wallet (wallet.ts detectWallets id, e.g. "ready"). Wallet
   * mode: it signs AND proves (STRK20 wallet API). Pool mode without a key:
   * it signs; the app's prover proves; the viewing key is derived from its
   * signature (wallet.ts deriveViewingKey).
   */
  walletId?: string;
  /**
   * Dev-mode only: messaging identity, when it differs from the signing
   * account — lets several browsers share one funded signer while remaining
   * distinct members of groups and threads. In pool mode identity IS the
   * account and this stays unset.
   */
  identityAddress?: string;
}

export interface FlushProgress {
  phase: "idle" | "encrypting" | "proving" | "submitted" | "confirmed" | "failed";
  startedAt?: number;
  secondsTotal?: number;
  txHash?: string;
  error?: string;
}

const CONFIG_KEY = "strk20msg.config";
const CONTACTS_KEY = "strk20msg.contacts";
const GROUPS_KEY = "strk20msg.groups";
const OUTBOX_KEY = "strk20msg.outbox";
const SYNC_KEY = "strk20msg.sync";

class LsOutboxStore implements OutboxStore {
  load(): OutboxEntry[] {
    try {
      return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as OutboxEntry[];
    } catch {
      return [];
    }
  }
  save(entries: OutboxEntry[]): void {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  }
}

class LsSyncStore implements SyncStore {
  load(): SyncSnapshot {
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      if (raw) return JSON.parse(raw) as SyncSnapshot;
    } catch {
      /* fresh */
    }
    return emptySnapshot();
  }
  save(s: SyncSnapshot): void {
    localStorage.setItem(SYNC_KEY, JSON.stringify(s));
  }
}

export function randomFelt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class AppStore {
  private listeners = new Set<() => void>();
  private version = 0;

  config: AppConfig | null;
  contacts: Contact[];
  groups: Group[];
  outbox: Outbox;
  flush: FlushProgress = { phase: "idle" };
  syncing = false;

  backend: Backend | null = null;
  engine: SyncEngine | null = null;
  private flushAbort: AbortController | null = null;

  constructor() {
    this.config = readJson<AppConfig>(CONFIG_KEY);
    this.contacts = readJson<Contact[]>(CONTACTS_KEY) ?? [];
    this.groups = readJson<Group[]>(GROUPS_KEY) ?? [];
    this.outbox = new Outbox(new LsOutboxStore());
    if (this.config?.onboarded) this.connect();
  }

  // -- plumbing -------------------------------------------------------------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private connect(): void {
    const cfg = this.config!;
    this.backend = this.backendFor(cfg);
    this.engine = new SyncEngine(this.backend.reader, new LsSyncStore());
    this.selfRegistered = null;
    this.strkBalance = null;
    void this.refreshSelfRegistration();
    void this.reconcileLanes();
    void this.refreshBalance();
  }

  /**
   * Pool mode: a contact's outbound lane is a derivation of OUR viewing key.
   * It is computed when the contact is added — so a contact added while the
   * wrong key was in Settings keeps a lane nobody will ever read, and a send
   * succeeds on-chain while landing in the void (it happened: Brave's first
   * message, tx 0x604e0cc7…). Re-derive every registered contact's lane from
   * the current key whenever the connection (re)connects.
   */
  async reconcileLanes(): Promise<void> {
    if (!this.isPool) return;
    let changed = 0;
    for (const c of this.contacts) {
      if (!c.registered) continue;
      try {
        const fresh = await this.backend!.pool!.outKeyFor(c.peer);
        if (BigInt(fresh) !== BigInt(c.outKey || "0x0")) {
          this.contacts = this.contacts.map((x) => (x === c ? { ...x, outKey: fresh } : x));
          changed++;
        }
      } catch {
        /* unregistered or unreachable: leave it */
      }
    }
    if (changed) {
      console.warn(`re-derived ${changed} outbound lane(s) from the current viewing key`);
      this.saveContacts();
    }
  }

  /** Incomplete real-mode settings fall back to demo — Settings gates Save so this is belt and braces. */
  private backendFor(cfg: AppConfig): Backend {
    if (cfg.mode === "direct" && cfg.rpcUrl && cfg.helperAddress && cfg.accountKey) {
      return new DirectBackend(cfg.rpcUrl, cfg.helperAddress, cfg.accountAddress, cfg.accountKey);
    }
    if (cfg.mode === "wallet" && cfg.rpcUrl && cfg.helperAddress && cfg.poolAddress && cfg.walletId && cfg.accountAddress) {
      return new WalletBackend({
        rpcUrl: cfg.rpcUrl,
        helperAddress: cfg.helperAddress,
        poolAddress: cfg.poolAddress,
        accountAddress: cfg.accountAddress,
        walletId: cfg.walletId,
        carrierToken: cfg.carrierToken,
      });
    }
    if (cfg.mode === "pool" && cfg.rpcUrl && cfg.helperAddress && cfg.poolAddress && (cfg.accountKey || cfg.walletId)) {
      return new PoolBackend({
        rpcUrl: cfg.rpcUrl,
        helperAddress: cfg.helperAddress,
        poolAddress: cfg.poolAddress,
        accountAddress: cfg.accountAddress,
        accountKey: cfg.accountKey || undefined,
        walletId: cfg.accountKey ? undefined : cfg.walletId,
        viewingKey: cfg.viewingKey,
        local: !!cfg.poolLocal,
        provingUrl: cfg.provingUrl,
        discoveryUrl: cfg.discoveryUrl,
        carrierToken: cfg.carrierToken,
        gatewayUrl: cfg.gatewayUrl,
        screeningProvingUrl: cfg.screeningProvingUrl,
      });
    }
    return new DemoBackend(cfg.provingSeconds);
  }

  /** The wait to show for a proof: the wallet's own typical time in wallet mode, else the configured seconds. */
  get provingSecondsHint(): number {
    if (this.config?.mode === "wallet") return typicalWalletSeconds() ?? 90;
    return this.config?.provingSeconds ?? 29;
  }

  get isPool(): boolean {
    return this.config?.mode === "pool" && !!this.backend?.pool;
  }

  /** Payments, requests, splits: the real pool, or the demo's simulated one. Not the direct dev helper. */
  get canPay(): boolean {
    return !!this.backend?.pool;
  }

  /** STRK balance of the signing account (real modes), null until read. */
  strkBalance: number | null = null;
  /** Pool fee per transaction (pool mode), for the "can I afford a send" hint. */
  poolFee: number | null = null;

  async refreshBalance(): Promise<void> {
    const cfg = this.config;
    if (!cfg || cfg.mode === "demo" || !cfg.rpcUrl) return;
    try {
      const { RpcProvider } = await import("starknet");
      const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
      const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
      const u256 = (r: string[]) => Number((BigInt(r[0] ?? "0x0") + (BigInt(r[1] ?? "0x0") << 128n)) / 10n ** 15n) / 1000;
      const bal = await provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [cfg.accountAddress] });
      this.strkBalance = u256(bal);
      if (cfg.poolAddress) {
        const fee = await provider.callContract({ contractAddress: cfg.poolAddress, entrypoint: "get_fee_amount", calldata: [] });
        this.poolFee = Number(BigInt(fee[0] ?? "0x0") / 10n ** 15n) / 1000;
      }
    } catch {
      this.strkBalance = null;
    }
    this.notify();
  }

  /** Pool mode: am I registered (SetViewingKey) — null until checked. */
  selfRegistered: boolean | null = null;
  /**
   * Pool mode: registered, but with a DIFFERENT viewing key than the one in
   * Settings. The one failure that is silent otherwise — every derivation
   * comes out wrong and discovery simply finds nothing. The pool stores
   * K = k·G; starknet.js's getStarkKey(k) is exactly that x-coordinate.
   */
  viewingKeyMismatch = false;

  async refreshSelfRegistration(): Promise<void> {
    if (!this.isPool) return;
    try {
      const pk = await (this.backend as unknown as { publicKeyOf(a: string): Promise<bigint> }).publicKeyOf(this.identity);
      this.selfRegistered = pk !== 0n;
      if (pk !== 0n) {
        const { ec } = await import("starknet");
        let mine = 0n;
        try {
          mine = BigInt(ec.starkCurve.getStarkKey(this.config!.viewingKey));
        } catch {
          mine = 0n;
        }
        this.viewingKeyMismatch = mine !== pk;
      } else {
        this.viewingKeyMismatch = false;
      }
    } catch {
      this.selfRegistered = null;
    }
    this.notify();
  }

  /**
   * Register on the pool without sending anything. Sends bundle registration
   * (autoRegister), but a send needs a registered recipient — so the first
   * two people in a pool would wait for each other forever without this.
   */
  async registerSelf(): Promise<void> {
    if (!this.isPool || this.flush.phase === "proving" || this.flush.phase === "submitted") return;
    this.flush = { phase: "proving", startedAt: Date.now(), secondsTotal: this.provingSecondsHint };
    this.notify();
    try {
      const { txHash } = await this.backend!.pool!.registerSelf((state) => {
        this.flush = { ...this.flush, phase: state };
        this.notify();
      });
      this.flush = { phase: "confirmed", txHash };
      this.notify();
      void this.refreshBalance();
      await this.refreshSelfRegistration();
    } catch (err) {
      this.flush = { phase: "failed", error: errorSummary(err) };
      this.notify();
    }
  }

  // -- onboarding -----------------------------------------------------------
  completeOnboarding(cfg: Omit<AppConfig, "onboarded">, restoredContacts: Contact[] = []): void {
    this.config = { ...cfg, onboarded: true };
    this.contacts = restoredContacts;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(this.contacts));
    this.connect();
    void this.backend!.register(this.config.accountAddress);
    this.notify();
  }

  /**
   * Wipe this browser's session (keys, contacts, outbox, sync, demo chain) and
   * return to onboarding. On-chain messages stay; without a backup you cannot
   * decrypt them here again.
   */
  disconnect(): void {
    for (const key of [CONFIG_KEY, CONTACTS_KEY, GROUPS_KEY, OUTBOX_KEY, SYNC_KEY, "strk20msg.demo.chain"]) {
      localStorage.removeItem(key);
    }
    this.config = null;
    this.contacts = [];
    this.groups = [];
    this.outbox = new Outbox(new LsOutboxStore());
    this.flush = { phase: "idle" };
    this.syncing = false;
    this.backend = null;
    this.engine = null;
    this.selfRegistered = null;
    this.strkBalance = null;
    this.notify();
  }

  /** Cancel only while encrypting/proving locally (before chain submission). */
  cancelFlush(): void {
    if (this.flush.phase === "encrypting" || this.flush.phase === "proving") this.flushAbort?.abort();
  }

  /** Pending outbox rows for a contact label or #group, oldest first. */
  pendingFor(to: string): OutboxEntry[] {
    return this.outbox
      .list()
      .filter((e) => e.to === to && e.status !== "confirmed")
      .sort((a, b) => a.queuedAt - b.queuedAt);
  }

  /** Switch mode / connection details (Settings) and reconnect the backend. */
  updateConnection(patch: Partial<AppConfig>): void {
    this.config = { ...this.config!, ...patch };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    this.connect();
    this.notify();
  }

  // -- contacts & the unregistered-recipient flow ---------------------------
  async addContact(
    label: string,
    peer: string,
    keys?: { outKey: string; inKey: string }
  ): Promise<Contact> {
    const registered = await this.backend!.isRegistered(peer);
    let contact: Contact;
    if (this.isPool) {
      // Pool mode: the pool IS the pairing. Our lane to them is derivable the
      // moment they are registered; theirs to us arrives through discovery.
      // Invites and address-derived dev lanes do not apply here.
      const outKey = registered ? await this.backend!.pool!.outKeyFor(peer) : "";
      const known = this.contacts.find((c) => sameAddr(c.peer, peer));
      contact = { label, peer, outKey, inKey: known?.inKey ?? "", registered, ...(known?.setupDone ? { setupDone: true } : {}) };
    } else {
      // No invite keys? Derive the lanes from the two addresses, so the peer
      // pairs by simply adding OUR address — devPairLane mirrors by construction.
      const me = BigInt(this.identity);
      const them = BigInt(peer);
      const derived = !keys;
      contact = {
        label,
        peer,
        outKey: keys?.outKey ?? "0x" + devPairLane(me, them).toString(16),
        inKey: keys?.inKey ?? "0x" + devPairLane(them, me).toString(16),
        registered,
        ...(derived ? { derived } : {}),
      };
    }
    this.contacts = [...this.contacts.filter((c) => c.label !== label && !(this.isPool && sameAddr(c.peer, peer))), contact];
    this.saveContacts();
    return contact;
  }

  async refreshRegistration(contact: Contact): Promise<void> {
    const registered = await this.backend!.isRegistered(contact.peer);
    if (registered === contact.registered && (!this.isPool || contact.outKey)) return;
    // Pool mode: registration is what makes our lane to them derivable.
    const outKey = this.isPool && registered && !contact.outKey ? await this.backend!.pool!.outKeyFor(contact.peer) : contact.outKey;
    this.contacts = this.contacts.map((c) => (c.peer === contact.peer ? { ...c, registered, outKey } : c));
    this.saveContacts();
  }

  private saveContacts(): void {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(this.contacts));
    this.notify();
  }

  /**
   * Pool mode: merge the pool's channel scan into contacts. An incoming lane
   * is the ONLY way to read what a peer sends us (only they can derive it);
   * an incoming lane from an address we do not know yet becomes a contact —
   * someone paid or messaged us first.
   */
  async discoverLanes(): Promise<{ updated: number; added: number }> {
    if (!this.isPool) return { updated: 0, added: 0 };
    const lanes = await this.backend!.pool!.discoverLanes();
    let updated = 0;
    let added = 0;
    for (const lane of lanes) {
      const existing = this.contacts.find((c) => sameAddr(c.peer, lane.peer));
      if (existing) {
        const next =
          lane.direction === "in"
            ? existing.inKey.toLowerCase() === lane.key.toLowerCase() ? existing : { ...existing, inKey: lane.key }
            : existing.setupDone && existing.outKey ? existing : { ...existing, outKey: existing.outKey || lane.key, setupDone: true };
        if (next !== existing) {
          this.contacts = this.contacts.map((c) => (c === existing ? next : c));
          updated++;
        }
      } else if (lane.direction === "in") {
        const registered = await this.backend!.isRegistered(lane.peer);
        const outKey = registered ? await this.backend!.pool!.outKeyFor(lane.peer) : "";
        this.contacts = [...this.contacts, { label: shortLabel(lane.peer, this.contacts), peer: lane.peer, outKey, inKey: lane.key, registered }];
        added++;
      }
    }
    if (updated + added > 0) this.saveContacts();
    return { updated, added };
  }

  simulatePeerRegistration(contact: Contact): void {
    this.backend?.demo?.simulatePeerRegistration(contact.peer);
    void this.refreshRegistration(contact);
  }

  /** Messaging identity: who I am in threads and groups (see identityAddress). */
  get identity(): string {
    return this.config?.identityAddress || this.config!.accountAddress;
  }

  // -- groups ---------------------------------------------------------------
  createGroup(name: string, members: GroupMember[]): Group {
    const group: Group = {
      name,
      groupKey: randomFelt(),
      // No viewer-relative labels in the stored/shared member list — "you" is
      // computed per viewer at stitch time.
      members: [{ address: this.identity }, ...members.filter((m) => m.address)],
    };
    this.groups = [...this.groups.filter((g) => g.name !== name), group];
    localStorage.setItem(GROUPS_KEY, JSON.stringify(this.groups));
    this.notify();
    return group;
  }

  joinGroup(invite: GroupInvite): Group {
    const group: Group = { name: invite.name, groupKey: invite.groupKey, members: invite.members };
    this.groups = [...this.groups.filter((g) => g.name !== group.name), group];
    localStorage.setItem(GROUPS_KEY, JSON.stringify(this.groups));
    this.notify();
    return group;
  }

  groupByName(name: string): Group | undefined {
    return this.groups.find((g) => g.name === name);
  }

  queueToGroup(group: Group, text: string): void {
    this.outbox.queue(`#${group.name}`, text);
    this.notify();
  }

  // -- outbox ---------------------------------------------------------------
  queue(contact: Contact, text: string): void {
    this.outbox.queue(contact.label, text);
    this.notify();
  }

  /**
   * Ask for a payment. A request is an ordinary message (REQ1 text), so it
   * queues into the outbox like any other and costs the sender no pool
   * balance — the payer's client turns it into a one-tap payment.
   */
  queueRequest(contact: Contact, token: string, amount: bigint, text: string): void {
    this.outbox.queue(contact.label, encodePaymentRequest(BigInt(token), amount, text));
    this.notify();
  }

  /** Resolve an outbox destination to the lane it writes on. */
  private laneFor(to: string): { laneHex: string; display: string; contact?: Contact } | null {
    if (to.startsWith("#")) {
      const group = this.groupByName(to.slice(1));
      return group ? { laneHex: myLane(group, this.identity), display: to } : null;
    }
    const contact = this.contacts.find((c) => c.label === to);
    // Pool mode: no lane until the peer registers (compose is blocked anyway).
    return contact && contact.outKey ? { laneHex: contact.outKey, display: contact.label, contact } : null;
  }

  queuedTiers(): number[] {
    return this.outbox.take().map((e) => tierOf(e.body, e.padTo));
  }

  /** Flush every queued message: one transaction per contact lane. */
  async sendBatch(): Promise<void> {
    const queued = this.outbox.take();
    if (queued.length === 0 || this.flush.phase === "proving" || this.flush.phase === "encrypting") return;
    const cfg = this.config!;
    this.flushAbort = new AbortController();
    const signal = this.flushAbort.signal;

    try {
      const byLane = new Map<string, { display: string; entries: OutboxEntry[]; contact?: Contact }>();
      for (const e of queued) {
        const dest = this.laneFor(e.to);
        if (!dest) continue;
        const bucket = byLane.get(dest.laneHex) ?? { display: dest.display, entries: [], contact: dest.contact };
        bucket.entries.push(e);
        byLane.set(dest.laneHex, bucket);
      }

      for (const [laneHex, { display, entries, contact: laneContact }] of byLane) {
        const outKey = BigInt(laneHex);
        let index = 0;
        for (;;) {
          const lens = await this.backend!.reader.slotLens(
            Array.from({ length: 16 }, (_, k) => msgId(outKey, index + k))
          );
          const empty = lens.findIndex((l) => l === 0);
          if (empty >= 0) {
            index += empty;
            break;
          }
          index += 16;
        }

        this.flush = { phase: "encrypting", startedAt: Date.now(), secondsTotal: this.provingSecondsHint };
        this.outbox.mark(entries.map((e) => e.id), "proving");
        this.notify();
        const items: { entry: OutboxEntry; sealed: Sealed; index: number }[] = entries.map(
          (entry, k) => ({
            entry,
            index: index + k,
            sealed: seal({
              channelKey: outKey,
              index: index + k,
              sender: BigInt(this.identity),
              timestamp: BigInt(Math.floor(Date.now() / 1000)),
              body: new TextEncoder().encode(entry.body),
            }),
          })
        );
        const ids = items.map((i) => i.entry.id);

        this.flush = {
          phase: "proving",
          startedAt: Date.now(),
          secondsTotal: this.provingSecondsHint,
        };
        this.outbox.mark(ids, "proving");
        this.notify();

        // Pool and wallet modes: address the carrier note to the peer, so the
        // channel is opened on first contact and left alone afterwards
        // (autoSetup) — and no self-transfer for the wallet to refuse.
        const setupPeer = (this.isPool || this.config?.mode === "wallet") && laneContact ? laneContact.peer : undefined;
        const { txHash } = await this.backend!.submitBatch(
          items.map((i) => i.sealed),
          (state) => {
            this.flush = { ...this.flush, phase: state };
            this.outbox.mark(ids, state);
            this.notify();
          },
          { ...(setupPeer ? { setupPeer } : {}), signal }
        );

        this.outbox.mark(ids, "confirmed", {
          txHash,
          indices: new Map(items.map((i) => [i.entry.id, i.index])),
        });
        if (setupPeer) this.markSetupDone(setupPeer);
        this.flush = { phase: "confirmed", txHash };
        this.notify();
        void this.refreshBalance();

        await this.syncNow();
        // Demo counterparty replies only in one-to-one threads — and pays a request.
        const contact = this.contacts.find((c) => c.label === display);
        if (contact) {
          const asked = entries.map((e) => decodePaymentRequest(e.body)).filter((r) => r !== null).pop();
          this.backend!.demo?.scheduleReply(
            contact,
            () => void this.syncNow(),
            asked ? { token: "0x" + asked.token.toString(16), amount: asked.amount, text: asked.text ? `for: ${asked.text}` : "here you go" } : undefined
          );
        }
      }
    } catch (err) {
      // A failed batch goes BACK to queued — retryable, never stuck in
      // "proving"/"submitted" limbo. (WriteOnce slots make an accidental
      // double-send self-defeating anyway: a re-flush re-walks the indices.)
      const stuck = [...this.outbox.list("proving"), ...this.outbox.list("submitted")].map((e) => e.id);
      if (stuck.length) this.outbox.mark(stuck, "queued");
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      this.flush = cancelled ? { phase: "idle" } : { phase: "failed", error: errorSummary(err) };
      this.notify();
    } finally {
      this.flushAbort = null;
    }
  }

  // -- pay (pool mode): a payment and its memo in ONE transaction -----------
  /**
   * Arch 1's core action. The transfer's enc notes are the replay protection
   * (no carrier), the memo carries token+amount INSIDE the ciphertext
   * (payment.ts) because the recipient cannot pair a memo with a note from
   * chain state, and — deliberately — we are the public submitter.
   */
  async pay(contact: Contact, token: string, amount: bigint, memo: string): Promise<void> {
    if (!this.canPay) throw new Error("payments need the pool");
    if (!contact.outKey) throw new Error(`${contact.label} is not registered on the pool yet`);
    if (this.flush.phase === "proving" || this.flush.phase === "submitted") return;
    const cfg = this.config!;
    const outKey = BigInt(contact.outKey);
    try {
      const index = await this.nextFreeIndex(outKey);
      const sealed = seal({
        channelKey: outKey,
        index,
        sender: BigInt(this.identity),
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        body: encodePaymentMemo(BigInt(token), amount, memo),
      });
      this.flush = { phase: "proving", startedAt: Date.now(), secondsTotal: this.provingSecondsHint };
      this.notify();
      const { txHash } = await this.backend!.pool!.pay(
        { token, recipient: contact.peer, amount },
        [sealed],
        (state) => {
          this.flush = { ...this.flush, phase: state };
          this.notify();
        }
      );
      this.markSetupDone(contact.peer);
      this.flush = { phase: "confirmed", txHash };
      this.notify();
      void this.refreshBalance();
      await this.syncNow();
      this.backend!.demo?.scheduleReply(contact, () => void this.syncNow());
    } catch (err) {
      this.flush = { phase: "failed", error: errorSummary(err) };
      this.notify();
    }
  }

  /** Wallet route: the wallet assembles this payment's actions without proving; see PoolControls.simulate. */
  async simulatePayment(contact: Contact, token: string, amount: bigint, memo: string): Promise<{ method: string; ok: boolean; detail: string }[]> {
    const sim = this.backend?.pool?.simulate;
    if (!sim) throw new Error("only the wallet route can simulate");
    const sealed = seal({
      channelKey: BigInt(contact.outKey),
      index: await this.nextFreeIndex(BigInt(contact.outKey)),
      sender: BigInt(this.identity),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: encodePaymentMemo(BigInt(token), amount, memo),
    });
    return sim([{ token, recipient: contact.peer, amount }], [sealed]);
  }

  /**
   * Split or tip in a group: one transaction carries a private transfer to
   * every chosen member AND one memo on my group lane naming them. One proof,
   * one fee, all or nothing. In pool mode every recipient must be registered
   * (the pool needs their key to encrypt the note to); the memo goes on the
   * shared group lane, so the group sees who was paid what — the pool doesn't.
   */
  async payGroup(group: Group, token: string, amountEach: bigint, recipients: GroupMember[], memo: string): Promise<void> {
    if (!this.canPay) throw new Error("payments need the pool");
    if (recipients.length === 0) throw new Error("choose at least one member");
    if (this.flush.phase === "proving" || this.flush.phase === "submitted") return;
    const cfg = this.config!;
    const laneKey = BigInt(myLane(group, this.identity));
    try {
      if (this.isPool) {
        for (const r of recipients) {
          if (!(await this.backend!.isRegistered(r.address))) {
            throw new Error(`${r.label ?? r.address} has not registered on the pool — the pool cannot encrypt a note to them`);
          }
        }
      }
      const index = await this.nextFreeIndex(laneKey);
      const names = recipients.map((r) => r.label ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`).join(", ");
      const sealed = seal({
        channelKey: laneKey,
        index,
        sender: BigInt(this.identity),
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        body: encodePaymentMemo(BigInt(token), amountEach, `to ${names}${memo.trim() ? ` — ${memo.trim()}` : ""}`),
      });
      this.flush = { phase: "proving", startedAt: Date.now(), secondsTotal: this.provingSecondsHint };
      this.notify();
      const { txHash } = await this.backend!.pool!.payMany(
        recipients.map((r) => ({ token, recipient: r.address, amount: amountEach })),
        [sealed],
        (state) => {
          this.flush = { ...this.flush, phase: state };
          this.notify();
        }
      );
      for (const r of recipients) this.markSetupDone(r.address);
      this.flush = { phase: "confirmed", txHash };
      this.notify();
      void this.refreshBalance();
      await this.syncNow();
    } catch (err) {
      this.flush = { phase: "failed", error: errorSummary(err) };
      this.notify();
    }
  }

  /** Public → private: approve + proven Deposit. Progress rides the flush bar. */
  async shield(token: string, amount: bigint): Promise<void> {
    if (!this.canPay || this.flush.phase === "proving" || this.flush.phase === "submitted") return;
    this.flush = { phase: "proving", startedAt: Date.now(), secondsTotal: this.provingSecondsHint };
    this.notify();
    try {
      const { txHash } = await this.backend!.pool!.shield(token, amount, (state) => {
        this.flush = { ...this.flush, phase: state };
        this.notify();
      });
      this.flush = { phase: "confirmed", txHash };
      this.notify();
      void this.refreshBalance();
    } catch (err) {
      const msg = errorSummary(err);
      this.flush = {
        phase: "failed",
        error: /SCREENING_REQUIRED/.test(msg)
          ? "the pool refused the deposit: SCREENING_REQUIRED — deposits need an attestation from the operator's screener; " +
            "set the screening prover URL in Settings once STRK20 provides it. (" + msg + ")"
          : msg,
      };
      this.notify();
    }
  }

  private async nextFreeIndex(laneKey: bigint): Promise<number> {
    let index = 0;
    for (;;) {
      const lens = await this.backend!.reader.slotLens(
        Array.from({ length: 16 }, (_, k) => msgId(laneKey, index + k))
      );
      const empty = lens.findIndex((l) => l === 0);
      if (empty >= 0) return index + empty;
      index += 16;
    }
  }

  private markSetupDone(peer: string): void {
    this.contacts = this.contacts.map((c) => (sameAddr(c.peer, peer) ? { ...c, setupDone: true } : c));
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(this.contacts));
  }

  // -- sync -----------------------------------------------------------------
  async syncNow(): Promise<void> {
    if (!this.engine || this.syncing) return;
    this.syncing = true;
    this.notify();
    try {
      if (this.isPool) {
        // Best effort: a discovery failure must not stop re-scanning known lanes.
        try {
          await this.discoverLanes();
        } catch (err) {
          console.warn("channel discovery skipped:", err);
        }
      }
      const me = this.identity;
      const keys = [
        ...this.contacts.flatMap((c) => [c.outKey, c.inKey]),
        ...this.groups.flatMap((g) => groupLanes(g, me).map((l) => l.laneKey)),
      ].filter((k) => k !== ""); // pool lanes not yet derivable/discovered
      await this.engine.sync(keys);
    } finally {
      this.syncing = false;
      this.notify();
    }
  }

  // -- backup ---------------------------------------------------------------
  backupJson(): string {
    const cfg = this.config!;
    return exportBackup({
      viewingKey: cfg.viewingKey,
      accountAddress: cfg.accountAddress,
      contacts: this.contacts,
    });
  }

  restoreFromBackup(json: string): { viewingKey: string; accountAddress: string; contacts: Contact[] } {
    const b = parseBackup(json);
    return { viewingKey: b.viewingKey, accountAddress: b.accountAddress, contacts: b.contacts };
  }
}

/**
 * A readable reason for a failed send. starknet.js RPC errors embed the whole
 * request (a 300 KB proof included) before the reason; the pool's own revert
 * string, when there is one, sits in `baseError.data.execution_error`.
 */
export function errorSummary(err: unknown): string {
  const e = err as { message?: string; baseError?: { code?: number; message?: string; data?: unknown } };
  const base = e?.baseError;
  if (base) {
    const data = base.data as { execution_error?: string } | string | undefined;
    const exec = typeof data === "string" ? data : data?.execution_error;
    const detail = exec ? ` — ${String(exec).split("Nested error:").pop()?.trim().slice(-300)}` : "";
    return `${base.message ?? "RPC error"}${base.code !== undefined ? ` (code ${base.code})` : ""}${detail}`;
  }
  const msg = e instanceof Error ? e.message : String(err);
  // "RPC: <method> with params {…huge…}" → keep the method and the tail.
  const m = /^RPC: (\S+) with params/.exec(msg);
  if (m && msg.length > 400) return `RPC ${m[1]} failed: …${msg.slice(-300).replace(/\s+/g, " ")}`;
  return msg.length > 400 ? `…${msg.slice(-400)}` : msg;
}

function sameAddr(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

/** A stable label for a peer discovery found before we named them. */
function shortLabel(peer: string, existing: Contact[]): string {
  const short = `${peer.slice(0, 6)}…${peer.slice(-4)}`;
  let label = short;
  for (let n = 2; existing.some((c) => c.label === label); n++) label = `${short}#${n}`;
  return label;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const store = new AppStore();
