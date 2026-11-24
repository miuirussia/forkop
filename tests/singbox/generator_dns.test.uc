let t = require("t");
let fixture = require("fixture");
let q = require("sbconfig");
let generator = require("singbox.generator");
let runtime_dns = require("singbox.dns");
let fs = require("fs");
let dir = require("stub").tmpdir();
runtime_dns.paths.network_resolv = dir + "/resolv.conf.auto";
runtime_dns.paths.legacy_network_resolv = dir + "/legacy-resolv.conf.auto";

function build(data) {
    fixture.seed(data);
    return generator.build({ service_address: "192.168.1.1" });
}

function network_config(settings) {
    return build({ settings, section: [ { ".name": "direct", enabled: "1", action: "bypass", destinations: "example.org" } ] });
}

t.test("network bootstrap uses netifd's upstreams and the selected fallback strategy", () => {
    fs.writefile(runtime_dns.paths.network_resolv, "# Interface wan\nnameserver 192.0.2.53\n nameserver\t2001:db8::53 # IPv6\nnameserver 192.0.2.53\nnameserver 127.0.0.1\nnameserver 127.0.0.42\nnameserver ::1\nnameserver 0:0:0:0:0:0:0:1\nnameserver 0.0.0.0\nnameserver ::\nnameserver invalid\nsearch lan\n");
    let config = network_config({ dns_server: [ "https://dns.example/dns-query" ],
        bootstrap_dns_server: [ "network", "192.0.2.53", "1.1.1.1" ], dns_bootstrap_fallback_strategy: "sequential" });
    let group = q.dns_server_tag(config, "bootstrap-dns-server");
    t.eq([ group.type, group.strategy ], [ "fallback", "sequential" ]);
    t.eq(map(group.servers, (tag) => q.dns_server_tag(config, tag).server), [ "192.0.2.53", "2001:db8::53", "1.1.1.1" ]);
    for (let tag in group.servers) {
        let server = q.dns_server_tag(config, tag);
        t.eq([ server.type, server.server_port, server.detour, server.domain_resolver ], [ "udp", 53, null, null ]);
    }
    t.eq(q.dns_server_tag(config, "dns-server").domain_resolver, "bootstrap-dns-server");
});

t.test("network bootstrap reads the legacy netifd path and refreshes addresses on each build", () => {
    fs.unlink(runtime_dns.paths.network_resolv);
    fs.writefile(runtime_dns.paths.legacy_network_resolv, "nameserver 192.0.2.54\n");
    let settings = { bootstrap_dns_server: [ "network" ] };
    t.eq(q.dns_server_tag(network_config(settings), "bootstrap-dns-server").server, "192.0.2.54");
    fs.writefile(runtime_dns.paths.network_resolv, "nameserver 192.0.2.55\n");
    t.eq(q.dns_server_tag(network_config(settings), "bootstrap-dns-server").server, "192.0.2.55");
    fs.unlink(runtime_dns.paths.network_resolv);
    fs.unlink(runtime_dns.paths.legacy_network_resolv);
});

t.test("missing network DNS requires an explicit bootstrap alternative", () => {
    let result = runtime_dns.config({ bootstrap_dns_server: [ "network" ] });
    t.contains(result.unsupported, "No network DNS servers are available for bootstrap");
    let config = network_config({ bootstrap_dns_server: [ "network", "1.1.1.1" ] });
    t.eq(q.dns_server_tag(config, "bootstrap-dns-server").server, "1.1.1.1");
});

t.test("a single DNS server is used directly", () => {
    let single = build({
        settings: { dns_server: [ "77.88.8.8" ], bootstrap_dns_server: [ "77.88.8.8" ] },
        section: [ { ".name": "direct", enabled: "1", action: "bypass", destinations: "example.org" } ]
    });
    t.eq(q.tags(single.dns.servers), [ "bootstrap-dns-server", "dns-server", "fakeip-server", "dnsmasq-server" ]);
    t.eq(q.dns_server_tag(single, "dns-server").server, "77.88.8.8");
    t.eq(q.dns_server_tag(single, "bootstrap-dns-server").server, "77.88.8.8");
    t.eq(length(single.inbounds), 7);
});

t.test("the router asks the bootstrap servers for its NTP servers, whatever the main DNS needs a clock for", () => {
    let ntp = (system_ntp) => filter(build({
        settings: { dns_server: [ "https://dns.google/dns-query" ] },
        section: [ { ".name": "direct", enabled: "1", action: "bypass", destinations: "example.org" } ],
        system_ntp
    }).dns.rules, (rule) => rule.server == "bootstrap-dns-server");
    t.eq(ntp({ enabled: "1", server: [ "0.openwrt.pool.ntp.org", "192.0.2.123", "time.example" ] }), [
        { inbound: "system-dns-in", action: "route", server: "bootstrap-dns-server", domain: [ "0.openwrt.pool.ntp.org", "time.example" ] }
    ], "names only: an address needs no lookup");
    t.eq(ntp({ enabled: "0", server: [ "0.openwrt.pool.ntp.org" ] }), [], "sysntpd turned off");
    t.eq(ntp({ server: [ "192.0.2.123" ] }), [], "addresses only");
    t.eq(ntp(null), [], "no NTP section");
});

t.test("several DNS servers become native fallback groups with their own query modes", () => {
    let multi = build({
        settings: {
            dns_server: [ "https://dns.google/dns-query", "https://cloudflare-dns.com/dns-query" ],
            bootstrap_dns_server: [ "1.1.1.1", "8.8.8.8" ],
            dns_main_fallback_strategy: "sequential", dns_bootstrap_fallback_strategy: "parallel",
            dns_detour_enabled: "1", dns_detour_section: "proxy"
        },
        section: [ {
            ".name": "proxy", enabled: "1", action: "connection",
            outbound_jsons: [ "{\"type\":\"direct\",\"tag\":\"fixture\"}" ], destinations: "example.org"
        } ]
    });
    t.eq(length(multi.dns.servers), 11, "global and section resolver groups, the local resolver and FakeIP");
    t.eq(length(multi.inbounds), 7);
    let bootstrap = q.dns_server_tag(multi, "bootstrap-dns-server");
    let main = q.dns_server_tag(multi, "dns-server");
    t.eq([ bootstrap.type, bootstrap.strategy, bootstrap.servers ], [ "fallback", "parallel", [ "bootstrap-dns-server-1", "bootstrap-dns-server-2" ] ]);
    t.eq([ main.type, main.strategy, main.servers ], [ "fallback", "sequential", [ "dns-server-1", "dns-server-2" ] ]);
    for (let tag in main.servers) {
        let candidate = q.dns_server_tag(multi, tag);
        t.eq([ candidate.detour, candidate.domain_resolver ], [ "proxy", "bootstrap-dns-server" ]);
    }
    t.eq(multi.route.default_domain_resolver, "bootstrap-dns-server", "a detoured DNS resolves endpoints through the bootstrap");
});

t.test("static records answer from a hosts server after the sections and before the local resolver", () => {
    let records = build({
        settings: {
            dns_server: [ "77.88.8.8" ], bootstrap_dns_server: [ "77.88.8.8" ],
            static_hosts_text: "# pinned by hand\n130.255.77.28 ntc.party www.ntc.party\n2a03:4000::1 NTC.party\n\n198.51.100.7 example.com # trailing note\n"
        },
        section: [
            { ".name": "pinned", enabled: "1", action: "bypass", destinations: "ntc.party" },
            { ".name": "direct_rule", enabled: "1", action: "bypass", destinations: "example.org" }
        ]
    });
    let hosts = q.dns_server_tag(records, "hosts-server");
    t.eq([ hosts.type, hosts.path ], [ "hosts", null ], "only the records Forkop was given, from no file");
    t.eq(hosts.predefined["ntc.party"], [ "130.255.77.28", "2a03:4000::1" ], "a repeated domain collects every address");
    t.eq(hosts.predefined["www.ntc.party"], [ "130.255.77.28" ]);
    t.ok(hosts.predefined["example.com"] != null, "a trailing comment keeps its record");
    t.eq(hosts.predefined["NTC.party"], null, "domains are lower-cased");

    let hosts_at = q.dns_rule_index(records, (r) => r.server == "hosts-server");
    let last_fakeip = -1;
    for (let i, rule in records.dns.rules)
        if (rule.server == "fakeip-server")
            last_fakeip = i;
    t.ok(hosts_at > last_fakeip, "sections keep their FakeIP answers");
    t.ok(hosts_at < q.dns_rule_index(records, (r) => r.server == "dnsmasq-server"), "records answer before the local resolver");
    t.eq(records.dns.rules[hosts_at].domain, [ "ntc.party", "www.ntc.party", "example.com" ]);
    t.eq(records.dns.rules[hosts_at].query_type, null, "the rule also matches the lookups sing-box makes to dial");

    let resolve_at = q.route_rule_index(records, (r) => r.action == "resolve" && r.server == "hosts-server");
    let section_at = q.route_rule_index(records, (r) => r.action == "route" && r.domain_suffix != null && r.domain_suffix[0] == "ntc.party");
    t.ok(resolve_at >= 0 && resolve_at < section_at, "records pin the address before a section routes the connection");
    for (let rule in records.route.rules)
        if (rule.action == "resolve" && rule.server != "hosts-server" && rule.domain != "ip.podkop.fyi")
            t.eq(rule.rules[length(rule.rules) - 1], { domain: records.dns.rules[hosts_at].domain, invert: true },
                "section resolution leaves the pinned records in place");
});

t.test("no records, no hosts server", () => {
    let empty = build({
        settings: { dns_server: [ "77.88.8.8" ], bootstrap_dns_server: [ "77.88.8.8" ] },
        section: [ { ".name": "pinned", enabled: "1", action: "bypass", destinations: "ntc.party" } ]
    });
    t.eq(q.dns_server_tag(empty, "hosts-server"), null);
    t.eq(q.dns_rule(empty, (r) => r.server == "hosts-server"), null);
    t.eq(q.route_rule(empty, (r) => r.server == "hosts-server"), null);
});

const DNS = { dns_server: [ "77.88.8.8" ], bootstrap_dns_server: [ "77.88.8.8" ] };
const BYPASS = [ { ".name": "direct", enabled: "1", action: "bypass", destinations: "example.org" } ];

t.test("a DNS inbound refuses what is not hijacked", () => {
    let config = build({ settings: DNS, section: BYPASS });
    let hijack = q.route_rule_index(config, (r) => r.action == "hijack-dns");
    for (let tag in [ "dns-in", "source-dns-in", "system-dns-in" ]) {
        let reject = q.route_rule_index(config, (r) => r.action == "reject" && r.inbound == tag);
        t.ok(reject > hijack, tag + " refuses the rest after hijack-dns");
    }
});

t.test("the router's own lookups reach sing-box whatever the sections say, and leave the way a client's do", () => {
    let config = build({ settings: DNS, section: BYPASS });
    t.eq(q.inbound(config, "system-dns-in").listen_port, 1605);
    t.ok(q.route_rule(config, (r) => r.action == "sniff" && q.has(r.inbound, "system-dns-in")) != null);
    t.ok(q.route_rule(config, (r) => r.action == "reject" && r.inbound == "system-dns-in") != null);
    let fallback = q.dns_rule(config, (r) => r.server == "dns-server" && q.has(r.inbound, "system-dns-in") &&
        r.domain_regex == null && r.domain_suffix == null && r.query_type == null);
    t.ok(fallback != null && q.has(fallback.inbound, "source-dns-in"), "one fallback for clients and the router");
    t.ok(q.dns_rule(config, (r) => r.server == "dnsmasq-server" && q.has(r.inbound, "system-dns-in") && r.domain_regex == "^[^.]+$") != null,
        "the router's local zone stays with its resolver");

    let router = build({
        settings: { ...DNS, unmatched_dns_mode: "router" },
        section: [ { ".name": "direct", enabled: "1", action: "bypass", destinations: "example.org", source_ip_cidr: [ "@system" ] } ]
    });
    t.ok(q.dns_rule(router, (r) => r.server == "dnsmasq-server" && q.has(r.inbound, "system-dns-in") &&
        r.type == null && r.domain_regex == null && r.domain_suffix == null && r.query_type == null) != null,
        "router mode hands the router's unmatched lookups back to its resolver too");
    t.ok(q.dns_rule(router, (r) => r.server == "dns-server" && q.has(r.inbound, "system-dns-in") && q.has(r.domain_suffix, "example.org") &&
        r.query_type == null) != null, "a System bypass takes real addresses the way any bypass does");
});

function response_matchers(rule) {
    let found = [];
    for (let part in rule.type == "logical" ? rule.rules : [ rule ])
        if (part.match_response == null)
            for (let key in [ "ip_cidr", "ip_is_private", "ip_accept_any" ])
                if (part[key] != null)
                    push(found, key);
    return found;
}

t.test("no DNS rule matches the answer without asking for it, which the core refuses", () => {
    let sections = [
        { ".name": "direct_some", enabled: "1", action: "bypass", destinations: "example.org", source_ip_cidr: [ "@system", "192.168.1.10/32" ] },
        { ".name": "direct_all", enabled: "1", action: "bypass", fully_routed_ips: [ "@system", "192.168.1.20/32" ] },
        { ".name": "dns_all", enabled: "1", action: "dns", dns_server: [ "8.8.8.8" ], fully_routed_ips: [ "192.168.1.30/32" ] }
    ];
    for (let mode in [ "forkop", "router" ]) {
        let config = build({ settings: { ...DNS, unmatched_dns_mode: mode }, section: sections });
        for (let rule in config.dns.rules)
            t.eq(response_matchers(rule), [], mode + ": " + sprintf("%J", rule));
    }
});

t.test("a device whose every query goes to one server keeps the local zone with the local resolver", () => {
    let config = build({ settings: DNS, dhcp_dnsmasq: { domain: "home" }, section: [
        { ".name": "dns_all", enabled: "1", action: "dns", dns_server: [ "8.8.8.8" ], fully_routed_ips: [ "@system", "192.168.1.20/32" ] },
        { ".name": "direct_all", enabled: "1", action: "bypass", fully_routed_ips: [ "192.168.1.30/32" ] }
    ] });
    let catch_all = (server, device) => q.dns_rule_index(config, (r) => r.server == server && device(r) &&
        r.domain == null && r.domain_suffix == null && r.domain_regex == null && r.query_type == null);
    let devices = [
        [ "dns_all-dns-server", "the router", (r) => q.has(r.inbound, "system-dns-in") && r.source_ip_cidr == null ],
        [ "dns_all-dns-server", "a client", (r) => q.has(r.source_ip_cidr, "192.168.1.20/32") ],
        [ "dns-server", "a bypassed client", (r) => q.has(r.source_ip_cidr, "192.168.1.30/32") ]
    ];
    for (let entry in devices) {
        let at = catch_all(entry[0], entry[2]);
        t.ok(at >= 0, entry[1] + ": every query goes to " + entry[0]);
        for (let zone in [ (r) => r.domain_regex == "^[^.]+$", (r) => r.domain_suffix == ".home", (r) => q.has(r.query_type, "PTR") ]) {
            let local = q.dns_rule_index(config, (r) => r.server == "dnsmasq-server" && entry[2](r) && zone(r));
            t.ok(local >= 0 && local < at, entry[1] + ": the local zone is answered first");
        }
    }

    let router = build({ settings: { ...DNS, unmatched_dns_mode: "router" }, section: [
        { ".name": "direct_all", enabled: "1", action: "bypass", fully_routed_ips: [ "192.168.1.30/32" ] }
    ] });
    t.ok(q.dns_rule(router, (r) => r.server == "dnsmasq-server" && q.has(r.source_ip_cidr, "192.168.1.30/32") && r.domain_regex == null) != null,
        "router mode: a bypassed client asks the local resolver for everything");
    t.eq(q.dns_rule(router, (r) => q.has(r.source_ip_cidr, "192.168.1.30/32") && r.domain_regex != null), null, "with nothing to carve out");
});

t.test("unmatched client DNS goes to Forkop, with the local zone left to whoever owns loopback 53", () => {
    let moved = build({ settings: DNS, dhcp_dnsmasq: { port: "5353", domain: "home" }, section: BYPASS });
    let local = q.dns_server_tag(moved, "dnsmasq-server");
    t.eq([ local.server, local.server_port ], [ "127.0.0.1", 53 ], "a moved dnsmasq port changes nothing about the fallback");
    t.ok(q.dns_rule(moved, (r) => r.server == "dns-server" && q.has(r.inbound, "source-dns-in") && r.domain_regex == null && r.domain_suffix == null && r.query_type == null) != null);
    t.ok(q.dns_rule(moved, (r) => r.server == "dnsmasq-server" && q.has(r.inbound, "source-dns-in") && r.domain_regex == "^[^.]+$") != null, "single-label names");
    t.ok(q.dns_rule(moved, (r) => r.server == "dnsmasq-server" && q.has(r.inbound, "source-dns-in") && r.domain_suffix == ".home") != null, "the DHCP domain");
    t.ok(q.dns_rule(moved, (r) => r.server == "dnsmasq-server" && q.has(r.inbound, "source-dns-in") && q.has(r.query_type, "PTR")) != null, "reverse lookups");
    let forkop_at = q.dns_rule_index(moved, (r) => r.server == "dns-server" && q.has(r.inbound, "source-dns-in") && r.domain_regex == null);
    for (let i, rule in moved.dns.rules)
        if (rule.server == "dnsmasq-server" && q.has(rule.inbound, "source-dns-in"))
            t.ok(i < forkop_at, "the local zone is answered before the Forkop fallback");

    let disabled = build({ settings: DNS, dhcp_dnsmasq: { port: "0" }, section: BYPASS });
    t.eq(q.dns_server_tag(disabled, "dnsmasq-server").server_port, 53, "a disabled dnsmasq port changes nothing either");
});

t.test("router mode hands every unmatched client query back to the local resolver", () => {
    let config = build({ settings: { ...DNS, unmatched_dns_mode: "router" }, dhcp_dnsmasq: { port: "5353", domain: "home" }, section: BYPASS });
    t.ok(q.dns_rule(config, (r) => r.server == "dnsmasq-server" && q.has(r.inbound, "source-dns-in") && r.domain_regex == null && r.domain_suffix == null && r.query_type == null) != null);
    t.eq(q.dns_rule(config, (r) => r.server == "dns-server" && q.has(r.inbound, "source-dns-in") && r.domain == null && r.domain_suffix == null && r.rule_set == null), null);
    t.eq(q.dns_rule(config, (r) => r.server == "dnsmasq-server" && r.domain_regex == "^[^.]+$"), null, "there is no local zone to carve out");
});

t.test("DNS timeout reaches the core as configured", () => {
    let config = build({
        settings: { dns_server: [ "1.1.1.1" ], bootstrap_dns_server: [ "1.1.1.1" ], dns_timeout: "4s" },
        section: [ { ".name": "direct", enabled: "1", action: "bypass", destinations: "example.org" } ]
    });
    t.eq(config.dns.timeout, "4s");
    t.eq(config.dns.optimistic, null);
    t.eq(config.dns.independent_cache, null);
    t.eq(config.experimental.cache_file.store_subscriptions, true);
});

t.test("each connection section resolves through its own outbound using the common DNS list", () => {
    let config = build({
        settings: { ...DNS, dns_server: [ "https://dns.example/dns-query", "tcp://9.9.9.9:5353" ], dns_main_fallback_strategy: "sequential" },
        section: [
            { ".name": "first", label: "First exit", action: "connection", destinations: "same.example", source_ip_cidr: [ "192.0.2.10/32" ],
                outbound_jsons: [ '{"type":"socks","server":"127.0.0.1","server_port":1080}' ] },
            { ".name": "second", label: "Second exit", action: "connection", destinations: "same.example", source_ip_cidr: [ "192.0.2.20/32" ],
                rule_set: [ "/tmp/section-domains.json" ], ports: [ "443" ],
                outbound_jsons: [ '{"type":"socks","server":"127.0.0.1","server_port":1081}' ] }
        ]
    });
    for (let entry in [ [ "first", "First exit" ], [ "second", "Second exit" ] ]) {
        let group = q.dns_server_tag(config, entry[0] + "-domain-resolver");
        t.eq([ group.type, group.strategy ], [ "fallback", "sequential" ]);
        let servers = map(group.servers, (tag) => q.dns_server_tag(config, tag));
        t.eq(map(servers, (server) => server.detour), [ entry[1], entry[1] ]);
        t.eq([ servers[0].server, servers[0].domain_resolver, servers[1].server_port ], [ "dns.example", "bootstrap-dns-server", 5353 ]);
        for (let i, rule in config.route.rules) {
            if (rule.action != "route" || rule.outbound != entry[1])
                continue;
            let resolve = config.route.rules[i - 1];
            t.eq([ resolve.action, resolve.server ], [ "resolve", null ], "DNS rules choose the section's resolver");
            let matchers = { ...resolve };
            delete matchers.action;
            delete matchers.server;
            let route_matchers = { ...rule };
            delete route_matchers.action;
            delete route_matchers.outbound;
            t.eq(matchers, route_matchers, "domain, rule-set, source and port constraints also apply to resolution");
        }
    }
    t.eq(q.dns_server_tag(config, "dns-server-1").detour, null, "unmatched DNS uses its configured route");
    let records = q.dns_rule(config, (rule) => rule.server == "first-domain-resolver");
    t.eq([ records.inbound, records.source_ip_cidr, records.domain_suffix, records.query_type ], [
        [ "source-dns-in", "tproxy-in", "tproxy6-in" ], "192.0.2.10/32", [ "same.example" ], null
    ], "client queries and internal lookups follow the same domain and device policy");
    t.ok(q.dns_rule(config, (rule) => rule.server == "second-domain-resolver") != null,
        "DNS chooses by domain and device; the application port only constrains routing");
});

t.test("a bypass resolves directly even when unmatched DNS uses another section", () => {
    let config = build({ settings: { ...DNS, dns_detour_enabled: "1", dns_detour_section: "vpn" }, section: [
        { ".name": "direct", action: "bypass", destinations: "direct.example" },
        { ".name": "vpn", action: "connection", destinations: "vpn.example", outbound_jsons: [ '{"type":"direct"}' ] },
        { ".name": "off", enabled: "0", action: "connection", outbound_jsons: [ '{"type":"direct"}' ] }
    ] });
    t.eq(q.dns_server_tag(config, "direct-domain-resolver").detour, "direct-out");
    t.eq(q.dns_server_tag(config, "vpn-domain-resolver-udp").detour, "vpn");
    t.eq(q.dns_server_tag(config, "off-domain-resolver"), null);
    t.eq(q.dns_rule(config, (rule) => q.has(rule.domain_suffix, "direct.example")).server, "direct-domain-resolver");
    t.eq(config.route.default_domain_resolver, "bootstrap-dns-server", "proxy endpoints can start before the detoured DNS");
});

t.test("HTTP exits can retry ordinary DNS over TCP without changing unmatched DNS", () => {
    for (let address in [ "77.88.8.8", "udp://dns.example:5353" ]) {
        let config = build({ settings: { ...DNS, dns_server: [ address ] }, section: [
            { ".name": "http", action: "connection", destinations: "example.org",
                outbound_jsons: [ '{"type":"http","server":"127.0.0.1","server_port":8080}' ] }
        ] });
        let resolver = q.dns_server_tag(config, "http-domain-resolver");
        t.eq([ resolver.type, resolver.strategy ], [ "fallback", "sequential" ]);
        let servers = map(resolver.servers, (tag) => q.dns_server_tag(config, tag));
        t.eq(map(servers, (server) => server.type), [ "udp", "tcp" ]);
        let original = q.dns_server_tag(config, "dns-server");
        t.eq([ original.type, original.detour ], [ "udp", null ]);
        for (let server in servers)
            t.eq([ server.server, server.server_port, server.domain_resolver, server.detour ],
                [ original.server, original.server_port, original.domain_resolver, "http" ]);
        t.ok(q.dns_rule(config, (rule) => rule.server == resolver.tag && q.has(rule.domain_suffix, "example.org")) != null);
    }
});

t.test("SOCKS4 destination lookups keep DNS section priority before the section resolver", () => {
    for (let source in [ "json", "link" ]) {
        let data = { settings: DNS, section: [
            { ".name": "higher", action: "dns", destinations: "private.example", dns_server: [ "10.0.0.53" ] },
            { ".name": "vpn", action: "connection", destinations: "private.example\npublic.example", ports: [ "443" ] },
            { ".name": "lower", action: "dns", destinations: "public.example", dns_server: [ "10.0.0.54" ] }
        ] };
        if (source == "json")
            data.section[1].outbound_jsons = [ '{"type":"socks","version":"4","tag":"exit","server":"127.0.0.1","server_port":1080}' ];
        else
            data.connection_link = [ { ".name": "exit", section: "vpn", name: "exit", uri: "socks4://127.0.0.1:1080" } ];
        let config = build(data);
        let higher = q.dns_rule_index(config, (rule) => rule.server == "higher-dns-server");
        let fallback = q.dns_rule_index(config, (rule) => rule.server == "vpn-domain-resolver");
        let lower = q.dns_rule_index(config, (rule) => rule.server == "lower-dns-server");
        t.ok(higher >= 0 && higher < fallback && fallback < lower, source + ": native lookups keep section order");
        t.eq(config.dns.rules[fallback].server, "vpn-domain-resolver");
        for (let rule in config.dns.rules)
            t.eq(rule.outbound, null, "DNS policy uses domain matchers, without the deprecated outbound matcher");
        for (let rule in config.route.rules)
            if (rule.action == "resolve")
                t.eq(rule.server, null, "lookups evaluate DNS rules before choosing a transport");
        t.ok(q.route_rule(config, (rule) => rule.outbound == "vpn" && q.has(rule.port, 443)) != null,
            "the connection still routes at the configured port");
    }
});

t.test("an interface's own resolver keeps responsibility for its section's destinations", () => {
    for (let enabled in [ "1", "0" ]) {
        let config = build({ settings: DNS,
            section: [ { ".name": "vpn", action: "connection", destinations: "corp.example",
                fully_routed_ips: [ "192.0.2.10/32" ] } ],
            section_interface: [ { ".name": "work", section: "vpn", name: "tun0",
                domain_resolver_enabled: enabled, domain_resolver_dns_server: [ "10.0.0.53" ] } ]
        });
        t.eq(q.outbound(config, "vpn/tun0").domain_resolver,
            enabled == "1" ? "vpn-interface-1-domain-resolver" : null);
        let resolves = filter(config.route.rules, (rule) => rule.action == "resolve");
        if (enabled == "1")
            t.eq(resolves, [], "neither section rules nor service and whole-device rules preempt the interface's DNS");
        else
            t.ok(length(resolves) > 0, "an interface without its own resolver uses the section's DNS");
        t.ok(q.route_rule(config, (rule) => rule.action == "route" && rule.outbound == "vpn") != null);
    }
});

t.test("whole-device DNS returns real addresses while explicit domain rules keep FakeIP", () => {
    let config = build({ settings: DNS, section: [
        { ".name": "vpn", action: "connection", destinations: "explicit.example",
            fully_routed_ips: [ "192.0.2.10/32", "@system" ], outbound_jsons: [ '{"type":"direct"}' ] }
    ] });
    for (let inbound in [ "source-dns-in", "system-dns-in" ]) {
        let fakeip = q.dns_rule(config, (rule) => rule.server == "fakeip-server" && q.has(rule.inbound, inbound) && rule.domain == null);
        t.eq(fakeip, null, "the whole-device fallback does not synthesize addresses");
        t.ok(q.dns_rule(config, (rule) => rule.server == "vpn-domain-resolver" && q.has(rule.inbound, inbound) && rule.query_type == null) != null);
        t.ok(q.dns_rule(config, (rule) => rule.server == "dnsmasq-server" && q.has(rule.inbound, inbound) && rule.domain_regex == "^[^.]+$") != null);
    }
    t.ok(q.dns_rule(config, (rule) => rule.server == "fakeip-server" && q.has(rule.domain_suffix, "explicit.example")) != null);
    for (let rule in config.dns.rules)
        t.ok(rule.action != "evaluate" && rule.action != "respond", "ordinary DNS routing needs no response evaluation");
    t.ok(q.route_rule(config, (rule) => rule.action == "resolve" && rule.server == null && q.has(rule.source_ip_cidr, "192.0.2.10/32")) != null);
    let internal = q.dns_rule(config, (rule) => rule.server == "vpn-domain-resolver" && rule.type == "logical" &&
        q.has(rule.rules[0].inbound, "tproxy-in") && q.has(rule.rules[0].source_ip_cidr, "192.0.2.10/32"));
    t.ok(internal != null, "the whole-device policy also covers internal lookups");
    t.contains(internal.rules, { protocol: "dns", invert: true }, "captured DNS keeps its separate policy");
});

t.done();
