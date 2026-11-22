let t = require("t");
let fixture = require("fixture");
let generator = require("singbox.generator");
let server = require("server.service");
let checks = require("diagnostics.checks");
let uci = require("core.uci");
let validation = require("validation");

function config(value) {
    return {
        settings: { dns_server: "1.1.1.1", ...(value == null ? {} : { enable_vpn_server: value }) },
        section: [ { ".name": "ads", action: "block", destinations: "ads.example" } ],
        server: [ { ".name": "vpn", label: "VPN", enabled: "1", protocol: "mixed", listen_port: "1080", mixed_auth_enabled: "0", routing_mode: "direct" } ]
    };
}

t.test("saved servers run only when the global switch is explicitly on", () => {
    for (let value in [ null, "0", "1" ]) {
        fixture.seed(config(value));
        let result = generator.build({ service_address: "127.0.0.1" });
        t.eq(length(filter(result.inbounds, (item) => item.tag == "VPN")), value == "1" ? 1 : 0);
        t.eq(uci.get("forkop.vpn.enabled"), "1", "disabling keeps the server's switch");
    }
});

t.test("a saved server alone is not runnable while the global switch is off", () => {
    let data = config(null);
    data.section = [];
    fixture.seed(data);
    t.ok(!generator.runnable());
    uci.set("forkop.settings.enable_vpn_server", "1");
    uci.commit("forkop");
    t.ok(generator.runnable());
    uci.set("forkop.settings.enable_vpn_server", "0");
    uci.commit("forkop");
    t.ok(!generator.runnable());
});

t.test("disabled servers need no preparation, validation or listener diagnostics", () => {
    let data = config("0");
    data.server[0].protocol = "unsupported";
    validation.accepts(data);
    data.settings.enable_vpn_server = null;
    validation.accepts(data);
    fixture.seed(data);
    server.prepare();
    t.eq(uci.get("forkop.vpn.protocol"), "unsupported");
    t.eq(checks.servers().items, []);
    data.settings.enable_vpn_server = "1";
    validation.refuses(data, "unsupported protocol");
});

t.done();
