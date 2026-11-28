let t = require("t");
let fixture = require("fixture");
let generator = require("singbox.generator");
let sb = require("sbconfig");
let c = require("singbox.constants");
let nft = require("nft.apply");

function build(extra, settings) {
    fixture.seed({ settings: fixture.settings(settings), section: [ { ".name": "dpi", label: "DPI exit", action: "desync", destinations: "example.org 203.0.113.0/24 2001:db8::/32", ...extra } ] });
    return generator.build({ service_address: "192.168.1.1" });
}

t.test("a standalone strategy becomes a marked flat desync outbound with bootstrap resolution", () => {
    let config = build({ desync_options: '{"preset":"custom","mode":"multi_split","split_pos":"sni,host+1","auto_tune":false,"tlsrec_first":false}' });
    t.eq(sb.outbound(config, "DPI exit"), { type: "desync", tag: "DPI exit", preset: "custom", mode: "multi_split", split_pos: "sni,host+1", auto_tune: false, tlsrec_first: false, routing_mark: c.OUTBOUND_MARK, domain_resolver: c.BOOTSTRAP_DNS_SERVER_TAG });
    t.ok(sb.no_internal_fields(config));
    t.ok(generator.runnable());
    t.eq(sb.route_rule(config, (r) => r.outbound == "DPI exit" && sb.has(r.domain_suffix, "example.org")).action, "route");
    t.ok(sb.dns_rule(config, (r) => r.server == c.FAKEIP_DNS_SERVER_TAG && sb.has(r.domain_suffix, "example.org")));
    t.ok(sb.dns_server(config, (s) => s.detour == "DPI exit"), "section resolver follows its exit");
});

t.test("QUIC blocking precedes Desync and UDP options survive generation", () => {
    let options = { preset: "GT2", udp_keep_socket: true, udp_out_range: "1:4", udp_mode: "quic", quic_desync: false, quic_repeats: 0, auto_tune: false };
    let config = build({ desync_options: sprintf("%J", options) }, { disable_quic: "1" });
    let reject = sb.route_rule_index(config, (r) => r.action == "reject" && r.protocol == "quic");
    let route = sb.route_rule_index(config, (r) => r.outbound == "DPI exit");
    t.ok(reject >= 0 && reject < route);
    for (let key, value in options) t.eq(sb.outbound(config, "DPI exit")[key], value);
});

t.test("all extended strategies reach the outbound without losing explicit overrides", () => {
    let fs = require("fs"), repo = require("repo");
    let contract = json(fs.readfile(repo.path("tests/fixtures/desync_extensions.json")));
    for (let options in contract.accepted) {
        let config = build({ desync_options: sprintf("%J", options) });
        let outbound = sb.outbound(config, "DPI exit");
        for (let key, value in options) t.eq(outbound[key], value, key);
        t.eq(outbound.type, "desync");
        t.eq(outbound.routing_mark, c.OUTBOUND_MARK);
        t.eq(outbound.domain_resolver, c.BOOTSTRAP_DNS_SERVER_TAG);
    }
});

t.test("Desync captures IPv4/IPv6 TCP and UDP and preserves the core bypass mark", () => {
    build({ ports: [ "443" ], fully_routed_ips: [ "192.168.1.10", "@system" ] });
    let script = nft.build().script;
    for (let text in [ "dpi_subnets", "dpi_subnets6", "dpi_fully_sources", "meta l4proto tcp", "meta l4proto udp", "meta mark & 0x08000000 == 0x08000000 counter return" ])
        t.contains(script, text);
});

t.test("connection link cascade keeps its protocol and uses the standalone desync socket exit", () => {
    fixture.seed({ settings: fixture.settings(), section: [ { ".name": "dpi", action: "desync" }, { ".name": "proxy", action: "connection", destinations: "example.org" } ],
        connection_link: fixture.links("proxy", [ "socks://example.org:1080#one" ], { detour_section: "dpi" }) });
    let config = generator.build({ service_address: "192.168.1.1" });
    t.eq(sb.outbound(config, "dpi").type, "desync");
    let node = sb.find(config.outbounds, (o) => o.detour == "dpi");
    t.ok(node, "a native link still dials through the selected exit");
});

t.test("the public IP check skips standalone Desync and uses the first connection section", () => {
    let config = build({});
    t.eq(sb.route_rule(config, (r) => r.action == "route" && r.domain == c.CHECK_PROXY_IP_DOMAIN), null,
        "Desync alone does not create a public IP exit check");

    fixture.seed({ settings: fixture.settings(), section: [
        { ".name": "dpi", label: "YouTube", action: "desync" },
        { ".name": "off", action: "connection", enabled: "0" },
        { ".name": "proxy", label: "Secured", action: "connection" }
    ], connection_link: fixture.links("proxy", [ "socks://example.org:1080#one" ]) });
    config = generator.build({ service_address: "192.168.1.1" });
    t.eq(sb.route_rule(config, (r) => r.action == "route" && r.domain == c.CHECK_PROXY_IP_DOMAIN).outbound, "Secured");
});

t.done();
