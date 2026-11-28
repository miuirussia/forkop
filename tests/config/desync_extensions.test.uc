let t = require("t");
let d = require("config.desync");
let fs = require("fs");
let repo = require("repo");
let contract = json(fs.readfile(repo.path("tests/fixtures/desync_extensions.json")));

t.test("new Desync settings round trip through UCI and strategy interchange", () => {
    for (let options in contract.accepted) {
        t.eq(d.validate(options), options);
        t.eq(d.import_strategy(d.export_strategy(options)), options);
        t.eq(d.options({ desync_options: sprintf("%J", options) }), { preset: "auto", ...options });
    }
    t.eq(d.options({
        desync_options: '{"strategy":"mode=fake_split fake_tls_random=true fake_tls_size=1200 fake_delay=100ms fake_tls_template=compact","fake_tls_random":false,"fake_tls_size":0,"fake_delay":"0s","fake_tls_template":""}'
    }), { preset: "auto", mode: "fake_split", fake_tls_random: false, fake_tls_size: 0, fake_delay: "0s", fake_tls_template: "" });
});

t.test("invalid extension syntax, ranges and combinations are rejected", () => {
    for (let options in contract.rejected)
        t.contains(t.throws(() => d.validate(options)).message, "Desync:", sprintf("%J", options));
});

t.test("semantic import validation follows explicit overrides", () => {
    for (let entry in contract.imports) {
        let options = d.options({ desync_options: sprintf("%J", entry.input) });
        t.eq(options, entry.options, sprintf("%J", entry.input));
        t.eq(d.import_strategy(d.export_strategy(options)), options);
    }
});

t.test("import syntax, types and invalid effective values remain rejected", () => {
    for (let input in contract.rejected_imports)
        t.contains(t.throws(() => d.options({ desync_options: sprintf("%J", input) })).message, "Desync:", sprintf("%J", input));
});

t.test("import validation waits for explicit JSON overrides before combination checks", () => {
    t.eq(d.options({ desync_options: '{"strategy":"tlsrec_pos=sni","mode":"tlsrec"}' }),
        { preset: "auto", mode: "tlsrec", tlsrec_pos: "sni" });
    t.eq(d.options({ desync_options: '{"strategy":"quic_order=reverse","udp_mode":"quic","quic_split_pos":"sni"}' }),
        { preset: "auto", udp_mode: "quic", quic_split_pos: "sni", quic_order: "reverse" });
});

t.done();
