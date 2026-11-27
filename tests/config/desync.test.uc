let t = require("t");
let d = require("config.desync");
let v = require("validation");
let fixture = require("fixture");

const CONTEXT = { sing_box_version: "1.14.4-r18" };
function section(options) { return { ".name": "dpi", action: "desync", desync_options: sprintf("%J", options ?? {}) }; }

t.test("UCI import folds into canonical JSON with explicit false and zero taking precedence", () => {
    t.eq(d.options({ desync_strategy: "mode=fake_split ttl=4 auto_tune=true", desync_options: '{"preset":"custom","auto_tune":false,"ttl":3,"seqovl":0}' }),
        { preset: "custom", mode: "fake_split", ttl: 3, auto_tune: false, seqovl: 0 });
    t.eq(d.options({}), { preset: "auto" });
    let options = { preset: "custom", mode: "multi_split", split_pos: "sni,host+1,endhost-1", tlsrec_first: false, auto_tune: false, seqovl: 0 };
    t.eq(d.import_strategy(d.export_strategy(options)), options);
    t.eq(d.import_strategy('mode="split" split_pos="midsld+1"'), { mode: "split", split_pos: "midsld+1" });
    let adaptive = { preset: "auto", auto_tune: true, adaptive: { max_attempts: 2, timeout: "5s" }, fake_sni_pool: [ "one.example", "two.example" ], tlsrec_first: false, seqovl: 0 };
    t.eq(d.import_strategy(d.export_strategy(adaptive)), adaptive);
    let quic = { preset: "GT2", quic_desync: false, quic_repeats: 0 };
    t.eq(d.import_strategy(d.export_strategy(quic)), quic);
    t.eq(d.options({ desync_strategy: "udp_mode=quic", desync_options: '{"quic_desync":false,"quic_repeats":0}' }), { preset: "auto", udp_mode: "quic", quic_desync: false, quic_repeats: 0 });
    t.eq(d.options({ desync_strategy: "auto_tune=true", desync_options: '{"preset":"custom","adaptive":{"max_attempts":2}}' }), { preset: "custom", auto_tune: true, adaptive: { max_attempts: 2 } });
});

t.test("unknown keys, socket fields, duplicate tokens and invalid values are refused", () => {
    for (let options in [ [], null, { detour: "proxy" }, { routing_mark: 0 }, { preset: "unknown" }, { mode: "magic" },
        { ttl: 0 }, { repeats: 17 }, { repeats: "1" }, { tlsrec_first: 1 }, { udp_mode: "random" }, { udp_out_range: "0:1" },
        { udp_out_range: "1:1025" }, { split_pos: "sni;exec" }, { fake_payload: "%%%" }, { delay: "2s" },
        { adaptive: { unknown: true } }, { preset: "custom", adaptive: {} }, { auto_tune: false, adaptive: {} }, { fooling: "unknown" },
        { quic_desync: true }, { quic_repeats: 0 }, { udp_mode: "quic", quic_desync: false, quic_repeats: 1 }, { udp_mode: "auto", quic_repeats: 17 } ])
        t.contains(t.throws(() => d.validate(options)).message, "Desync:", sprintf("%J", options));
    for (let text in [ "mode=split mode=fake", "nonsense", "strategy=mode=split", "ttl=abc", 'mode="split"xxx' ])
        t.contains(t.throws(() => d.import_strategy(text)).message, "Desync:", text);
});

t.test("Desync requires r18 and respects an authoritative capability refusal", () => {
    v.refuses({ section: [ section() ] }, "requires sing-box-forkop 1.14.4-r18", { sing_box_version: "1.14.4-r17" });
    v.accepts({ section: [ section() ] }, CONTEXT);
    v.refuses({ section: [ section() ] }, "does not advertise", { ...CONTEXT, desync_capabilities: { supported: false } });
    t.eq(d.support_problem("1.14.4-r18", { capability: "forkop-desync-v1", supported: true }), "");
});

t.test("standalone Desync needs no server; links and subscriptions can use it as their direct exit", () => {
    let sections = [ section({ preset: "split", auto_tune: false }), { ".name": "proxy", action: "connection" } ];
    v.accepts({ section: sections, connection_link: fixture.links("proxy", [ "socks://example.org:1080#one" ], { detour_section: "dpi" }) }, CONTEXT);
    v.accepts({ section: sections, subscription_url: [ { ".name": "sub", section: "proxy", url: "https://example.org/sub", tag: "sub", detour_section: "dpi" } ] }, CONTEXT);
    v.accepts({ section: [ section() ], settings: { dns_detour_enabled: "1", dns_detour_section: "dpi" } }, CONTEXT);
    v.accepts({ section: [ section() ], settings: { download_lists_via_proxy: "1", download_lists_via_proxy_section: "dpi" } }, CONTEXT);
});

t.test("Desync cannot wrap another socket or contain a cascade; disabled sections are ignored", () => {
    v.refuses({ section: [ section() ], connection_link: fixture.links("dpi", [ "socks://example.org:1080#one" ]) }, "cannot contain connection sources or cascades", CONTEXT);
    v.refuses({ section: [ { ...section(), detour_section: "other" } ] }, "cannot contain connection sources or cascades", CONTEXT);
    v.refuses({ section: [ section(), { ".name": "source", action: "connection" } ],
        tunnel: [ { ".name": "tun", section: "source", kind: "ssh", name: "SSH", detour_section: "dpi" } ] }, "only connection links and subscriptions", CONTEXT);
    v.accepts({ section: [ { ...section({ unknown: true }), enabled: "0" } ] });
});

t.test("every fooling token preserves the shared import/export contract", () => {
    let fs = require("fs"), repo = require("repo");
    let contract = json(fs.readfile(repo.path("tests/fixtures/desync_fooling.json")));
    for (let fooling in contract.accepted) {
        let options = { mode: "fake_split", fooling, auto_tune: false, seqovl: 0 };
        t.eq(d.validate(options), options);
        t.eq(d.import_strategy(d.export_strategy(options)), options);
        t.eq(d.options({ desync_options: sprintf("%J", { ...options, preset: "custom" }) }), { ...options, preset: "custom" });
    }
    for (let fooling in contract.rejected)
        t.contains(t.throws(() => d.validate({ mode: "fake_split", fooling })).message, "unknown fooling");
});

t.done();
