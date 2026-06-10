import { randomBytes } from "node:crypto";

/** A single agent operation (mirrors the device-agent grammar). */
export type Op = {
  type: string;
  config?: string;
  section?: string;
  section_type?: string;
  option?: string;
  value?: string;
  values?: Record<string, string>;
  list?: string[];
  name?: string;
  action?: string;
  // file.write / file.delete
  path?: string;
  content?: string;
  mode?: string;
};

export type RuleType =
  | "pause_device"
  | "pause_group"
  | "block_domains_network"
  | "force_router_dns"
  | "block_managed_list"
  | "block_ip_set"
  | "block_brainrot_group"
  | "block_schedule_group";

export type PauseDeviceParams = { mac: string; client_name?: string };
export type PauseGroupParams = { group_id: string; group_name?: string };
export type BlockDomainsParams = { domains: string[] };
export type ForceRouterDnsParams = Record<string, never>;
/**
 * A snapshot of a curated upstream blocklist. We don't store the whole list
 * in params (it's ~17k entries / ~600KB) — just the source identifier and a
 * timestamp. The current snapshot is fetched at apply time and dropped into
 * a single dnsmasq conf file on the router via a `file.write` op.
 */
export type BlockManagedListParams = {
  source: "hagezi-anti-bypass";
  snapshot_at: string; // ISO timestamp of when the source was last fetched
  domain_count: number;
};
/**
 * Firewall-layer block of an upstream IP list. Generates a tiny nftables
 * include (`/etc/nftables.d/bt-<id>.nft`) with a `set` of addresses + a
 * forward-hook chain at priority -10 (fires before fw4's main filter chain
 * at priority 0) that REJECTs matching outbound traffic.
 */
export type BlockIpSetParams = {
  source: "dibdot-doh-ipv4" | "dibdot-doh-ipv6" | "tor-exit-ipv4";
  // If set, only block traffic to this port; otherwise block any port.
  // DoH typically only matters on 443. Tor uses many ports → omit.
  dest_port?: number;
  snapshot_at: string;
  ip_count: number;
};
/**
 * Per-kid brainrot block. Scope is a group's MACs; domains default to the
 * curated DEFAULT_BRAINROT_DOMAINS but can be overridden. Implementation
 * uses dnsmasq tagging: a per-rule conf file emits dhcp-host entries that
 * attach a tag to each member MAC and then address= rules scoped to that
 * tag. Result: only the tagged kid's lookups return 0.0.0.0/:: — everyone
 * else on the network resolves normally.
 */
export type BlockBrainrotGroupParams = {
  group_id: string;
  group_name?: string;
  domains?: string[]; // override; otherwise DEFAULT_BRAINROT_DOMAINS
};
/**
 * Like block_brainrot_group, but the on-device policy engine decides
 * per-minute whether to enforce or pass-through based on a schedule:
 *
 *   - allow_windows: time-of-day windows on specific weekdays
 *   - allow_quotas:  per-period minute budgets (day/weekend/weekday/week)
 *
 * Both are OR'd. Empty arrays = block always (same effect as
 * block_brainrot_group). At least one of the two must be non-empty for
 * the rule to be meaningful as a "schedule".
 */
export type BlockScheduleGroupParams = {
  group_id: string;
  group_name?: string;
  app_label: string; // "YouTube", "TikTok", etc. — displayed on /blocked
  domains?: string[]; // override; otherwise DEFAULT_BRAINROT_DOMAINS
  allow_windows?: TimeWindow[];
  allow_quotas?: QuotaWindow[];
};
export type RuleParams =
  | PauseDeviceParams
  | PauseGroupParams
  | BlockDomainsParams
  | ForceRouterDnsParams
  | BlockManagedListParams
  | BlockIpSetParams
  | BlockBrainrotGroupParams
  | BlockScheduleGroupParams;

/**
 * The canonical "brainrot" — infinite-scroll algorithmic feeds Bri can
 * block per-kid. Curated for breadth (root domains; dnsmasq matches
 * subdomains) without false positives that break unrelated services.
 *
 * Notable trade-offs:
 *  - googlevideo.com is included even though it also serves Google Drive
 *    / Photos video previews. Worth it: it's the YouTube delivery CDN.
 *  - threads.net (Meta) included since it's the IG sibling app.
 *  - bytedance.com included to catch TikTok's various v.tiktok-style
 *    redirects and the partner SDKs apps embed.
 *  - reddit included because of its addictive feed; remove if a kid uses
 *    it for school research.
 */
export const DEFAULT_BRAINROT_DOMAINS: string[] = [
  // YouTube
  "youtube.com", "youtu.be", "ytimg.com", "googlevideo.com", "youtube-nocookie.com", "ggpht.com", "yt.be",
  // Instagram + Threads
  "instagram.com", "cdninstagram.com", "ig.me", "threads.net",
  // TikTok
  "tiktok.com", "tiktokcdn.com", "tiktokv.com", "musical.ly", "bytedance.com", "byteoversea.com",
  // Snapchat
  "snapchat.com", "snap.com", "sc-cdn.net",
  // Reddit
  "reddit.com", "redd.it", "redditstatic.com", "redditmedia.com",
  // Twitter / X
  "twitter.com", "x.com", "t.co", "twimg.com",
  // Twitch
  "twitch.tv", "ttvnw.net", "jtvnw.net",
];

export interface AccountRule {
  rule_id: string;
  rule_type: RuleType;
  params: RuleParams;
  ops: Op[];
  name: string;
  summary?: string;
  active: boolean;
}

export function newRuleId(
  prefix:
    | "pause"
    | "pausegrp"
    | "domains"
    | "dnsforce"
    | "mlist"
    | "ipset"
    | "brainrot"
    | "sched",
): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

/**
 * Path on the router for a brainrot rule's nftables include. dnsmasq doesn't
 * support per-tag DNS responses (the `tag:TAG,address=...` syntax is not
 * accepted), so per-MAC blocks live in nftables: a MAC set + dynamic IP
 * sets the agent refreshes by resolving the configured domains every
 * ~30 seconds.
 */
export function brainrotNftPath(ruleId: string): string {
  return `/etc/nftables.d/bt-${ruleId}.nft`;
}
/**
 * Side-car JSON state file the agent reads to know which domains to resolve
 * + which nft sets to populate for this rule. Kept separate from the nft
 * file so the executor can write static structural state and the agent
 * keeps dynamic IP state independently.
 */
export function brainrotJsonPath(ruleId: string): string {
  return `/etc/braintech/brainrot/${ruleId}.json`;
}

export function newGroupId(): string {
  return `grp_${randomBytes(4).toString("hex")}`;
}

/** Path on the router for a pause_group rule's nftables include. */
export function pauseGroupNftPath(ruleId: string): string {
  return `/etc/nftables.d/bt-${ruleId}.nft`;
}

/** Path on the router for a managed-list rule's dnsmasq conf snippet. */
export function managedListConfPath(ruleId: string): string {
  return `/etc/dnsmasq.d/bt-${ruleId}.conf`;
}

/** Path on the router for a block_ip_set rule's nftables include. */
export function ipSetNftPath(ruleId: string): string {
  return `/etc/nftables.d/bt-${ruleId}.nft`;
}

/**
 * What a rule "owns" on the device. Cleanup removes every owned target
 * regardless of whether the rule is active right now — that's how a
 * transition from active→inactive actually drops state on the router.
 *
 *   - kind:"uci"  → a named UCI section (`bt_<ruleId>[_suffix]`)
 *   - kind:"file" → a file on the router (managed-list rules use one
 *                   dnsmasq conf snippet per rule under /etc/dnsmasq.d/)
 */
export type CleanupTarget =
  | { kind: "uci"; config: string; section: string }
  | { kind: "file"; path: string };

export function ownedTargets(
  ruleId: string,
  type: RuleType,
): CleanupTarget[] {
  switch (type) {
    case "pause_device":
      return [{ kind: "uci", config: "firewall", section: `bt_${ruleId}` }];
    case "block_domains_network":
      return []; // owns dnsmasq address list entries, wiped by assembleDesired
    case "force_router_dns":
      return [
        { kind: "uci", config: "firewall", section: `bt_${ruleId}_t` },
        { kind: "uci", config: "firewall", section: `bt_${ruleId}_u` },
        { kind: "uci", config: "firewall", section: `bt_${ruleId}_dot` },
      ];
    case "block_managed_list":
      return [{ kind: "file", path: managedListConfPath(ruleId) }];
    case "block_ip_set":
      return [{ kind: "file", path: ipSetNftPath(ruleId) }];
    case "pause_group":
      return [{ kind: "file", path: pauseGroupNftPath(ruleId) }];
    case "block_brainrot_group":
      return [
        { kind: "file", path: brainrotNftPath(ruleId) },
        { kind: "file", path: brainrotJsonPath(ruleId) },
      ];
    case "block_schedule_group":
      return [
        { kind: "file", path: brainrotNftPath(ruleId) },
        { kind: "file", path: brainrotJsonPath(ruleId) },
        { kind: "file", path: policyDocPath(ruleId) },
      ];
  }
}

/** Cleanup ops for a single rule's owned targets. */
export function buildCleanupOps(ruleId: string, type: RuleType): Op[] {
  return ownedTargets(ruleId, type).map((t) => {
    if (t.kind === "uci") {
      return { type: "uci.delete", config: t.config, section: t.section };
    }
    return { type: "file.delete", path: t.path };
  });
}

/**
 * Build the device-agent ops a single rule contributes when it's APPLIED.
 * Cleanup ops (deletes) are generated by `assembleDesired` so the device's
 * desired state is reproducible from the list of active rules each time.
 */
export function buildRuleOps(
  ruleId: string,
  type: RuleType,
  params: RuleParams,
): Op[] {
  switch (type) {
    case "pause_device": {
      const p = params as PauseDeviceParams;
      const section = `bt_${ruleId}`;
      return [
        // declare a named section so we can clean it up by name later
        { type: "uci.set", config: "firewall", section, value: "rule" },
        {
          type: "uci.set",
          config: "firewall",
          section,
          values: {
            name: ruleId,
            src: "lan",
            target: "REJECT",
            src_mac: p.mac,
            enabled: "1",
          },
        },
      ];
    }
    case "block_domains_network": {
      const p = params as BlockDomainsParams;
      // Emit both A (0.0.0.0) and AAAA (::) blocks. Without the AAAA entry,
      // dnsmasq returns NXDOMAIN/0.0.0.0 for A but FORWARDS AAAA upstream —
      // so any client with IPv6 connectivity (modern phones especially)
      // still reaches the host.
      const entries: string[] = [];
      for (const d of p.domains) {
        entries.push(`/${d}/0.0.0.0`);
        entries.push(`/${d}/::`);
      }
      return [
        {
          type: "uci.add_list",
          config: "dhcp",
          section: "@dnsmasq[0]",
          option: "address",
          list: entries,
        },
      ];
    }
    case "block_managed_list": {
      // OpenWrt's dnsmasq init reads /tmp/dnsmasq.cfg*.d/ but NOT
      // /etc/dnsmasq.d/ unless we add `confdir` to /etc/config/dhcp first.
      // We set it idempotently as part of every managed-list rule.
      // Structural placeholder for the file content — filled in at assembly
      // time by materializeOps() (we don't store a 1MB blob in account_rules
      // or chat_sessions.pending_proposal).
      return [
        {
          type: "uci.set",
          config: "dhcp",
          section: "@dnsmasq[0]",
          option: "confdir",
          value: "/etc/dnsmasq.d",
        },
        {
          type: "file.write",
          path: managedListConfPath(ruleId),
          content: "",
          mode: "644",
        },
      ];
    }
    case "block_ip_set": {
      // Structural placeholder — content is filled in at assembly time
      // by materializeOps() (fresh fetch of the IP list).
      return [
        {
          type: "file.write",
          path: ipSetNftPath(ruleId),
          content: "",
          mode: "644",
        },
        { type: "service", name: "firewall", action: "reload" },
      ];
    }
    case "pause_group": {
      // Structural placeholder — MAC set is populated at assembly time
      // from current group membership.
      return [
        {
          type: "file.write",
          path: pauseGroupNftPath(ruleId),
          content: "",
          mode: "644",
        },
        { type: "service", name: "firewall", action: "reload" },
      ];
    }
    case "block_brainrot_group": {
      // Structural placeholders — MAC set + domain list are filled in at
      // assembly time by materializeOps. The nft file defines static
      // structure (MAC set, empty IP sets, chain); the JSON file tells the
      // agent which domains to resolve into those IP sets. Agent refreshes
      // IPs every ~30s — see device-agent/brainrot.go.
      return [
        {
          type: "file.write",
          path: brainrotJsonPath(ruleId),
          content: "",
          mode: "644",
        },
        {
          type: "file.write",
          path: brainrotNftPath(ruleId),
          content: "",
          mode: "644",
        },
        { type: "service", name: "firewall", action: "reload" },
      ];
    }
    case "block_schedule_group": {
      // Three files: nft (chain + empty sets), brainrot JSON (domains + macs
      // for the DNS watcher), policy JSON (windows + quotas for the engine).
      // The MAC set starts empty in the nft file — the policy engine
      // populates it when enforcement is currently required and clears it
      // when the schedule says "allow".
      return [
        {
          type: "file.write",
          path: brainrotJsonPath(ruleId),
          content: "",
          mode: "644",
        },
        {
          type: "file.write",
          path: policyDocPath(ruleId),
          content: "",
          mode: "644",
        },
        {
          type: "file.write",
          path: brainrotNftPath(ruleId),
          content: "",
          mode: "644",
        },
        { type: "service", name: "firewall", action: "reload" },
      ];
    }
    case "force_router_dns": {
      // Three firewall sections:
      //   bt_<id>_t  — DNAT redirect for LAN tcp/53  → the router's own dnsmasq
      //   bt_<id>_u  — DNAT redirect for LAN udp/53  → same
      //   bt_<id>_dot — REJECT LAN → wan tcp/853 (DNS over TLS)
      //
      // Without dest_ip the redirect target is the router itself (fw4
      // resolves it to the lan-side address). The src='lan' scope means
      // router-originated DNS queries (dnsmasq forwarding upstream) are
      // never matched — only client traffic.
      //
      // DoH (HTTPS on 443) isn't blocked here — that needs a separate
      // policy (block known DoH endpoint IPs + DoH bootstrap domains).
      // Plain DNS coverage is the 90% win; DoH bypass is a follow-up.
      const tcp = `bt_${ruleId}_t`;
      const udp = `bt_${ruleId}_u`;
      const dot = `bt_${ruleId}_dot`;
      return [
        // tcp/53 redirect
        { type: "uci.set", config: "firewall", section: tcp, value: "redirect" },
        {
          type: "uci.set",
          config: "firewall",
          section: tcp,
          values: {
            name: `bt-dns-tcp-${ruleId}`,
            src: "lan",
            proto: "tcp",
            src_dport: "53",
            dest_port: "53",
            target: "DNAT",
            enabled: "1",
          },
        },
        // udp/53 redirect
        { type: "uci.set", config: "firewall", section: udp, value: "redirect" },
        {
          type: "uci.set",
          config: "firewall",
          section: udp,
          values: {
            name: `bt-dns-udp-${ruleId}`,
            src: "lan",
            proto: "udp",
            src_dport: "53",
            dest_port: "53",
            target: "DNAT",
            enabled: "1",
          },
        },
        // DoT block
        { type: "uci.set", config: "firewall", section: dot, value: "rule" },
        {
          type: "uci.set",
          config: "firewall",
          section: dot,
          values: {
            name: `bt-dot-${ruleId}`,
            src: "lan",
            dest: "wan",
            proto: "tcp",
            dest_port: "853",
            target: "REJECT",
            enabled: "1",
          },
        },
      ];
    }
  }
}

/**
 * Assemble the device's full `desired` ops array from the parent's active
 * rules. The pattern is "wipe-then-rebuild" so the result is idempotent:
 *
 *  1. Idempotent cleanup of anything we might have left from prior versions
 *     (delete every paused-device named section we've ever issued; clear the
 *     dnsmasq address list). The agent tolerates "Entry not found", so these
 *     are safe no-ops when nothing's there.
 *  2. Apply each active rule's ops in order.
 *  3. Append commits for the touched UCI configs + service reloads.
 */
// ---------------------------------------------------------------------------
// Managed-list sources — curated upstream blocklists Bri can apply by name.
// Each source has a canonical URL and a parser; we fetch on demand at apply /
// reset time and embed the resulting dnsmasq conf into a file.write op.
// ---------------------------------------------------------------------------

export const MANAGED_LIST_SOURCES = {
  "hagezi-anti-bypass": {
    label: "HaGeZi anti-bypass (VPN + DoH/DoT + Tor bootstrap + proxies)",
    // jsDelivr CDN-fronted — avoids the raw.githubusercontent rate limit.
    url:
      "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/doh-vpn-proxy-bypass-onlydomains.txt",
  },
} as const;

export type ManagedListSource = keyof typeof MANAGED_LIST_SOURCES;

/**
 * Fetch + parse a managed list to a clean domain array. Lines starting with
 * `#` or whitespace-only are dropped. We trust jsDelivr's CDN to handle
 * caching; we don't carry our own in-process cache because Vercel functions
 * are short-lived and per-invocation state doesn't persist anyway.
 */
export async function fetchManagedListDomains(
  source: ManagedListSource,
): Promise<string[]> {
  const cfg = MANAGED_LIST_SOURCES[source];
  if (!cfg) throw new Error(`unknown managed-list source: ${source}`);
  const res = await fetch(cfg.url, {
    headers: { "User-Agent": "braintech-bot/1.0 (+https://getbraintech.com)" },
  });
  if (!res.ok) throw new Error(`fetch ${source} failed: ${res.status}`);
  const text = await res.text();
  const domains: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // dnsmasq accepts only the bare domain; reject anything fishy
    if (!/^[A-Za-z0-9._-]+$/.test(line)) continue;
    domains.push(line.toLowerCase());
  }
  return domains;
}

/** Build the dnsmasq conf-file contents (A + AAAA block per domain). */
export function dnsmasqBlockConf(domains: string[]): string {
  const lines: string[] = [
    "# Braintech — managed blocklist (auto-generated, do not edit)",
    `# ${domains.length} domains, A + AAAA each`,
    "",
  ];
  for (const d of domains) {
    lines.push(`address=/${d}/0.0.0.0`);
    lines.push(`address=/${d}/::`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// IP-set sources — upstream feeds of IP addresses to firewall-block. Used by
// block_ip_set rules. Each source produces one set + one forward-hook chain
// in /etc/nftables.d/bt-<ruleId>.nft (auto-included by fw4 reload).
// ---------------------------------------------------------------------------

export const IP_SET_SOURCES = {
  "dibdot-doh-ipv4": {
    label: "DoH endpoint IPv4 addresses (dibdot)",
    url: "https://raw.githubusercontent.com/dibdot/DoH-IP-blocklists/master/doh-ipv4.txt",
    family: "ipv4" as const,
    default_dest_port: 443,
  },
  "dibdot-doh-ipv6": {
    label: "DoH endpoint IPv6 addresses (dibdot)",
    url: "https://raw.githubusercontent.com/dibdot/DoH-IP-blocklists/master/doh-ipv6.txt",
    family: "ipv6" as const,
    default_dest_port: 443,
  },
  "tor-exit-ipv4": {
    label: "Tor exit-node IPv4 addresses (torproject.org bulk list)",
    url: "https://check.torproject.org/torbulkexitlist",
    family: "ipv4" as const,
    default_dest_port: undefined, // Tor uses many ports → block any
  },
} as const;

export type IpSetSource = keyof typeof IP_SET_SOURCES;

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

/**
 * Fetch + parse an IP-set source. Strips `#` comments and blank lines.
 * Validates each entry against a coarse regex appropriate for its family;
 * the kernel rejects truly malformed entries on `nft -f` so we don't need
 * to be strict here.
 */
export async function fetchIpSetEntries(
  source: IpSetSource,
): Promise<string[]> {
  const cfg = IP_SET_SOURCES[source];
  if (!cfg) throw new Error(`unknown ip-set source: ${source}`);
  const res = await fetch(cfg.url, {
    headers: { "User-Agent": "braintech-bot/1.0 (+https://getbraintech.com)" },
  });
  if (!res.ok) throw new Error(`fetch ${source} failed: ${res.status}`);
  const text = await res.text();
  const re = cfg.family === "ipv4" ? IPV4_RE : IPV6_RE;
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // strip inline comments (`1.0.0.1  # cloudflare` → `1.0.0.1`)
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    if (!re.test(line)) continue;
    out.push(line);
  }
  return out;
}

/**
 * Build the nftables include file: one set + one forward-hook chain that
 * rejects packets whose destination matches. We hook at priority -10 so we
 * fire BEFORE fw4's main forward chain (priority 0) — kernel runs both
 * chains, ours rejects first if it matches.
 */
export function nftBlockIpSetFile(
  ruleId: string,
  family: "ipv4" | "ipv6",
  entries: string[],
  destPort?: number,
): string {
  const setName = `bt_${ruleId}_set`;
  const chainName = `bt_${ruleId}`;
  const addrType = family === "ipv4" ? "ipv4_addr" : "ipv6_addr";
  const ipMatch = family === "ipv4" ? "ip daddr" : "ip6 daddr";
  const portClause = destPort != null ? ` tcp dport ${destPort}` : "";
  const lines: string[] = [];
  lines.push(`# Braintech — managed IP blocklist (auto-generated, do not edit)`);
  lines.push(`# ${entries.length} entries, family=${family}, dest_port=${destPort ?? "any"}`);
  lines.push(``);
  lines.push(`set ${setName} {`);
  lines.push(`    type ${addrType}`);
  lines.push(`    flags interval`);
  if (entries.length > 0) {
    // nft accepts a comma-separated braced literal; long lists wrap fine.
    lines.push(`    elements = {`);
    // chunk 8 per line so the file is readable in logread/cat
    for (let i = 0; i < entries.length; i += 8) {
      const chunk = entries.slice(i, i + 8).join(", ");
      const isLast = i + 8 >= entries.length;
      lines.push(`        ${chunk}${isLast ? "" : ","}`);
    }
    lines.push(`    }`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`chain ${chainName} {`);
  lines.push(`    type filter hook forward priority -10; policy accept;`);
  lines.push(`    ${ipMatch} @${setName}${portClause} reject comment "bt:${ruleId}"`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

/**
 * Build the nftables include for a brainrot block scoped to a group's MACs.
 *
 * Why nft, not dnsmasq: dnsmasq's `tag:<tag>,address=/domain/0.0.0.0`
 * syntax — which would let us null-route domains for one MAC and not
 * another — is NOT a real dnsmasq option. dnsmasq's `tag:` prefix only
 * works on DHCP options. We previously emitted it anyway and crashed
 * dnsmasq with "bad option" → DNS died on the whole LAN. That was the
 * postmortem that produced this design.
 *
 * Mechanism: three nft sets + one chain at forward priority -10:
 *   - bt_<id>_macs   : ether_addr   (MAC set, populated at write time)
 *   - bt_<id>_ips4   : ipv4_addr w/ timeout (refreshed by the agent)
 *   - bt_<id>_ips6   : ipv6_addr w/ timeout (refreshed by the agent)
 *   - chain bt_<id>  : ether saddr ∈ macs && ip[6] daddr ∈ ips[46] → reject
 *
 * The agent (device-agent/brainrot.go) reads the side-car JSON file for
 * this rule, resolves each domain every ~30s, and runs
 * `nft add element inet fw4 bt_<id>_ips[46] { IP }` for each result. Sets
 * are declared with timeout so stale CDN IPs age out automatically.
 *
 * On fw4 reload, the include re-creates the sets (empty); the agent's next
 * refresh cycle re-populates them. Worst-case window without protection
 * after a reload is one refresh cycle (~30s).
 */
export function nftBrainrotFile(ruleId: string, macs: string[]): string {
  const macSet = `bt_${ruleId}_macs`;
  const ip4Set = `bt_${ruleId}_ips4`;
  const ip6Set = `bt_${ruleId}_ips6`;
  const chain = `bt_${ruleId}`;
  const lines: string[] = [];
  lines.push("# Braintech — brainrot per-MAC block (auto-generated, do not edit)");
  lines.push(`# rule ${ruleId} — ${macs.length} MACs`);
  lines.push("# IP sets are refreshed by the agent (resolve domains -> nft add element)");
  lines.push("");

  // MAC set — populated at file-write time.
  lines.push(`set ${macSet} {`);
  lines.push(`    type ether_addr`);
  if (macs.length > 0) {
    lines.push(`    elements = {`);
    for (let i = 0; i < macs.length; i += 4) {
      const chunk = macs.slice(i, i + 4).join(", ");
      const isLast = i + 4 >= macs.length;
      lines.push(`        ${chunk}${isLast ? "" : ","}`);
    }
    lines.push(`    }`);
  }
  lines.push(`}`);
  lines.push("");

  // IP sets — agent populates these at runtime. timeout=2h means stale
  // CDN IPs roll off automatically without us having to track them.
  lines.push(`set ${ip4Set} {`);
  lines.push(`    type ipv4_addr`);
  lines.push(`    flags interval, timeout`);
  lines.push(`    timeout 2h`);
  lines.push(`}`);
  lines.push("");
  lines.push(`set ${ip6Set} {`);
  lines.push(`    type ipv6_addr`);
  lines.push(`    flags interval, timeout`);
  lines.push(`    timeout 2h`);
  lines.push(`}`);
  lines.push("");

  // Prerouting NAT: HTTP (port 80) traffic from kid MACs going to blocked
  // IPs gets DNAT'd to the captive server on 192.168.1.254:80. The captive
  // server responds with a 302 to getbraintech.com/blocked?host=<original>
  // so the kid sees a friendly page instead of a connection error. HTTPS
  // (port 443) is NOT rewritten — HSTS makes that impossible without root
  // cert installation. We DNAT v4 only; v6 captive isn't worth wiring.
  const natChain = `${chain}_dnat`;
  lines.push(`chain ${natChain} {`);
  lines.push(`    type nat hook prerouting priority -100; policy accept;`);
  if (macs.length > 0) {
    lines.push(
      `    ether saddr @${macSet} tcp dport 80 ip daddr @${ip4Set} dnat to 192.168.1.254:80 comment "bt:${ruleId} captive"`,
    );
  } else {
    lines.push(`    # (no member MACs — chain is inert)`);
  }
  lines.push(`}`);
  lines.push("");

  // Forward filter: reject everything else from the MAC set to the IP sets.
  // Port 80 traffic was already redirected in prerouting above; this catches
  // port 443 (HTTPS) and any other port. Anyone outside the MAC set
  // (parents) keeps full access; any destination not in the IP set is
  // unaffected (the rest of the internet still works).
  lines.push(`chain ${chain} {`);
  lines.push(`    type filter hook forward priority -10; policy accept;`);
  if (macs.length > 0) {
    lines.push(
      `    ether saddr @${macSet} ip daddr @${ip4Set} reject comment "bt:${ruleId} v4"`,
    );
    lines.push(
      `    ether saddr @${macSet} ip6 daddr @${ip6Set} reject comment "bt:${ruleId} v6"`,
    );
  } else {
    lines.push(`    # (no member MACs — chain is inert)`);
  }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

/**
 * Side-car JSON the agent watches for. Tells the refresh loop which sets
 * to populate from which domains AND which MACs to attribute observed
 * queries to (for per-MAC quota counting in the policy engine). Shape is
 * small and stable on purpose — both block_brainrot_group and
 * block_schedule_group rules use this same file.
 */
export function brainrotStateJson(
  ruleId: string,
  domains: string[],
  macs: string[],
): string {
  return JSON.stringify(
    {
      rule_id: ruleId,
      ip4_set: `bt_${ruleId}_ips4`,
      ip6_set: `bt_${ruleId}_ips6`,
      domains,
      macs,
      updated_at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n";
}

/* ────────────────────────────────────────────────────────────────────────
 * Policy schema (scaffold)
 *
 * A policy is a small JSON document that the SERVER writes once at rule
 * deploy time and the AGENT'S on-device engine evaluates every minute.
 * Everything operational (time check, quota tracking, enforcement
 * toggle) lives on the router — the cloud has zero involvement in the
 * minute-by-minute decision.
 *
 * Today there's one policy `kind`: "block_unless". It says: "block
 * traffic from <macs> to <domains> UNLESS one of the allow clauses
 * matches right now." Allow clauses OR together:
 *
 *   - allow_windows: time-of-day windows on specific weekdays
 *   - allow_quotas:  per-period minute budgets
 *
 * The engine resolves "right now":
 *   • Time window match: today's local weekday is in `days` AND local
 *     clock is between `start_min_of_day` and `end_min_of_day`.
 *   • Quota match: total minutes used in this `period` <= `minutes_max`.
 *
 * Quota tracking is stubbed in the agent (always reports under-quota
 * for now). Wiring it to client_usage_minute / a local counter is the
 * next push.
 *
 * Adding new rule kinds: add a new value to `PolicyDoc.kind`, define
 * its allow logic, and teach `policy.go::evaluate` how to read it.
 * The MAC-set-toggle enforcement model stays the same.
 * ──────────────────────────────────────────────────────────────────── */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type TimeWindow = {
  days: Weekday[];
  /** Minutes from midnight in LOCAL time (0..1439). Start inclusive,
   *  end exclusive. So 14:00–17:00 = { start: 840, end: 1020 }. */
  start_min_of_day: number;
  end_min_of_day: number;
};

export type QuotaWindow = {
  /** "day" = midnight to midnight, "week" = Monday to Sunday,
   *  "weekend" = Saturday + Sunday, "weekday" = Mon–Fri. */
  period: "day" | "week" | "weekend" | "weekday";
  minutes_max: number;
};

export type BlockUnlessPolicy = {
  kind: "block_unless";
  /** Stable opaque id matching the account_rules row + nft set names. */
  rule_id: string;
  /** Display label for the app being blocked ("YouTube"). */
  app_label: string;
  /** Domains the policy targets (used for stats + future allow-list
   *  scoping). The actual IP set is populated by brainrotDNSWatcher
   *  from CNAME-chain resolutions of these. */
  domains: string[];
  /** Kid MACs the policy applies to. Engine writes these to the nft
   *  MAC set when the policy is in "blocking" state, clears them when
   *  in "allowing" state. */
  macs: string[];
  /** Nft set names the engine toggles. */
  nft_mac_set: string;
  /** Allow clauses — ANY match → allow. Empty arrays → never allow
   *  (effectively a permanent block, equivalent to block_brainrot_group). */
  allow_windows: TimeWindow[];
  allow_quotas: QuotaWindow[];
  /** RFC3339 timestamp; informational. */
  updated_at: string;
};

export function policyDocPath(ruleId: string): string {
  return `/etc/braintech/policy/${ruleId}.json`;
}

export function policyBlockUnlessJson(
  ruleId: string,
  appLabel: string,
  domains: string[],
  macs: string[],
  allowWindows: TimeWindow[],
  allowQuotas: QuotaWindow[],
): string {
  const doc: BlockUnlessPolicy = {
    kind: "block_unless",
    rule_id: ruleId,
    app_label: appLabel,
    domains,
    macs,
    nft_mac_set: `bt_${ruleId}_macs`,
    allow_windows: allowWindows,
    allow_quotas: allowQuotas,
    updated_at: new Date().toISOString(),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Helper: convert "14:30" → 870 minutes from midnight. Inverse for
 * generation isn't needed yet (UI sends start/end-min directly).
 */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`invalid HH:MM "${hhmm}"`);
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) {
    throw new Error(`out-of-range HH:MM "${hhmm}"`);
  }
  return h * 60 + mm;
}

/**
 * Build the nftables include for a pause_group rule: a set of MAC addresses
 * + a forward-hook chain at priority -10 that REJECTs anything sourced from
 * any MAC in the set. Identical pattern to nftBlockIpSetFile but matches on
 * ether saddr instead of ip daddr.
 */
export function nftPauseGroupFile(ruleId: string, macs: string[]): string {
  const setName = `bt_${ruleId}_macs`;
  const chainName = `bt_${ruleId}`;
  const lines: string[] = [];
  lines.push(`# Braintech — group pause (auto-generated, do not edit)`);
  lines.push(`# ${macs.length} MACs`);
  lines.push(``);
  lines.push(`set ${setName} {`);
  lines.push(`    type ether_addr`);
  if (macs.length > 0) {
    lines.push(`    elements = {`);
    for (let i = 0; i < macs.length; i += 4) {
      const chunk = macs.slice(i, i + 4).join(", ");
      const isLast = i + 4 >= macs.length;
      lines.push(`        ${chunk}${isLast ? "" : ","}`);
    }
    lines.push(`    }`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`chain ${chainName} {`);
  lines.push(`    type filter hook forward priority -10; policy accept;`);
  lines.push(`    ether saddr @${setName} reject comment "bt:${ruleId}"`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

/**
 * Optional context passed to materializeOps. Currently the only context
 * any rule type needs is the group→MACs map for pause_group. Callers
 * resolve membership once from the DB before iterating rules.
 */
export type MaterializeContext = {
  groupMacs?: Map<string, string[]>;
};

/**
 * Materialize a rule into the actual ops the agent will run. For most rule
 * types this is just the structural ops from buildRuleOps. For rules that
 * carry an upstream-fetched blob (block_managed_list, block_ip_set), this
 * fetches the source and inlines its content into the relevant file.write
 * op — everything else (uci.set, service reload) flows through unchanged.
 * For pause_group, the current group membership is pulled from ctx.
 */
export async function materializeOps(
  rule: AccountRule,
  ctx: MaterializeContext = {},
): Promise<Op[]> {
  if (rule.rule_type === "block_managed_list") {
    const p = rule.params as BlockManagedListParams;
    const domains = await fetchManagedListDomains(p.source);
    const conf = dnsmasqBlockConf(domains);
    const path = managedListConfPath(rule.rule_id);
    return rule.ops.map((o) =>
      o.type === "file.write" && o.path === path ? { ...o, content: conf } : o,
    );
  }
  if (rule.rule_type === "block_ip_set") {
    const p = rule.params as BlockIpSetParams;
    const cfg = IP_SET_SOURCES[p.source];
    const entries = await fetchIpSetEntries(p.source);
    const content = nftBlockIpSetFile(
      rule.rule_id,
      cfg.family,
      entries,
      p.dest_port ?? cfg.default_dest_port,
    );
    const path = ipSetNftPath(rule.rule_id);
    return rule.ops.map((o) =>
      o.type === "file.write" && o.path === path ? { ...o, content } : o,
    );
  }
  if (rule.rule_type === "pause_group") {
    const p = rule.params as PauseGroupParams;
    const macs = ctx.groupMacs?.get(p.group_id) ?? [];
    const content = nftPauseGroupFile(rule.rule_id, macs);
    const path = pauseGroupNftPath(rule.rule_id);
    return rule.ops.map((o) =>
      o.type === "file.write" && o.path === path ? { ...o, content } : o,
    );
  }
  if (rule.rule_type === "block_brainrot_group") {
    const p = rule.params as BlockBrainrotGroupParams;
    const macs = ctx.groupMacs?.get(p.group_id) ?? [];
    const domains = p.domains?.length ? p.domains : DEFAULT_BRAINROT_DOMAINS;
    const nftContent = nftBrainrotFile(rule.rule_id, macs);
    const jsonContent = brainrotStateJson(rule.rule_id, domains, macs);
    const nftPath = brainrotNftPath(rule.rule_id);
    const jsonPath = brainrotJsonPath(rule.rule_id);
    return rule.ops.map((o) => {
      if (o.type !== "file.write") return o;
      if (o.path === nftPath) return { ...o, content: nftContent };
      if (o.path === jsonPath) return { ...o, content: jsonContent };
      return o;
    });
  }
  if (rule.rule_type === "block_schedule_group") {
    const p = rule.params as BlockScheduleGroupParams;
    const macs = ctx.groupMacs?.get(p.group_id) ?? [];
    const domains = p.domains?.length ? p.domains : DEFAULT_BRAINROT_DOMAINS;
    // Schedule rules use the SAME nft chain + IP sets as block_brainrot_group,
    // but the MAC set starts empty — the on-device policy engine populates
    // it when the schedule says "enforce" and clears it when "allow".
    const nftContent = nftBrainrotFile(rule.rule_id, []);
    const brainrotContent = brainrotStateJson(rule.rule_id, domains, macs);
    const policyContent = policyBlockUnlessJson(
      rule.rule_id,
      p.app_label,
      domains,
      macs,
      p.allow_windows ?? [],
      p.allow_quotas ?? [],
    );
    const nftPath = brainrotNftPath(rule.rule_id);
    const brainrotPath = brainrotJsonPath(rule.rule_id);
    const policyPath = policyDocPath(rule.rule_id);
    return rule.ops.map((o) => {
      if (o.type !== "file.write") return o;
      if (o.path === nftPath) return { ...o, content: nftContent };
      if (o.path === brainrotPath) return { ...o, content: brainrotContent };
      if (o.path === policyPath) return { ...o, content: policyContent };
      return o;
    });
  }
  return rule.ops;
}

/**
 * Build the device's full desired ops from every rule ever issued (active
 * or not). The pattern is "wipe-then-rebuild":
 *
 *   1. Cleanup every named UCI section any rule has ever owned + always
 *      wipe the dnsmasq address list. The agent's uci.delete is tolerant
 *      of missing entries, so it's safe to delete things that don't exist.
 *   2. Re-emit ops for ACTIVE rules only.
 *   3. Commit firewall + dhcp and reload firewall + dnsmasq. We always
 *      touch both configs above (the cleanup writes to both), so we must
 *      always commit AND reload both — otherwise the running daemon holds
 *      stale state from before the cleanup.
 *
 * Pass ALL rules (active and inactive). Inactive rules contribute cleanup
 * ops only; active rules contribute cleanup + apply. This makes the desired
 * state a pure function of (allRules) with no path-dependence.
 */
export function assembleDesired(allRules: AccountRule[]): Op[] {
  const ops: Op[] = [];

  // (1) cleanup — every owned section across every rule we know about.
  for (const r of allRules) {
    for (const o of buildCleanupOps(r.rule_id, r.rule_type)) ops.push(o);
  }
  // Always wipe the dnsmasq address list — domain rules own it as a shared
  // resource and we rebuild it from scratch each time.
  ops.push({ type: "uci.delete", config: "dhcp", section: "@dnsmasq[0]", option: "address" });

  // (2) apply each active rule's ops
  for (const r of allRules) {
    if (!r.active) continue;
    for (const o of r.ops) ops.push(o);
  }

  // (3) commit + reload firewall + dhcp/dnsmasq unconditionally
  ops.push({ type: "uci.commit", config: "firewall" });
  ops.push({ type: "uci.commit", config: "dhcp" });
  ops.push({ type: "service", name: "firewall", action: "reload" });
  ops.push({ type: "service", name: "dnsmasq", action: "reload" });

  return ops;
}
