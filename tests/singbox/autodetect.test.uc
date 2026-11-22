let t = require("t");
let fixture = require("fixture");
let generator = require("singbox.generator");
let v = require("validation");
let fs = require("fs");
let stub = require("stub");
let features = require("singbox.features");
let validator = require("config.validator");

function data(settings) {
    return {
        settings: fixture.settings(settings),
        section: [ { ".name": "main", label: "VPN Main", action: "connection", enabled: "1" } ],
        connection_link: fixture.links("main", [ "socks://127.0.0.1:1080#one" ])
    };
}

t.test("Autodetect adds native core options only when enabled, without extra listeners", () => {
    fixture.seed(data());
    let off = generator.build({ service_address: "127.0.0.1" });
    t.eq(off.experimental.clash_api.autodetect, null);
    fixture.seed(data({ enable_autodetect: "1", autodetect_proxy_section: "main" }));
    let on = generator.build({ service_address: "127.0.0.1" });
    t.eq(on.experimental.clash_api.autodetect, {
        direct: "direct-out", proxy: "VPN Main", timeout: "8s", confirmations: 2,
        stall_timeout: "9s", response_limit: 65536, recheck_interval: "15m", history_limit: 100
    });
    t.eq(on.inbounds, off.inbounds);
    let bootstrap = generator.build({ service_address: "127.0.0.1", bootstrap: true });
    t.eq(bootstrap.experimental.clash_api.autodetect, null);
});

t.test("Autodetect requires an enabled connection section with servers", () => {
    v.accepts(data({ enable_autodetect: "1", autodetect_proxy_section: "main" }), { sing_box_version: "1.14.4-r8" });
    v.refuses(data({ enable_autodetect: "1" }), "Autodetect");
    v.refuses(data({ enable_autodetect: "1", autodetect_proxy_section: "missing" }), "does not exist");
    let disabled = data({ enable_autodetect: "1", autodetect_proxy_section: "main" });
    disabled.section[0].enabled = "0";
    v.refuses(disabled, "disabled");
    let empty = data({ enable_autodetect: "1", autodetect_proxy_section: "main" });
    empty.connection_link = [];
    v.refuses(empty, "has no servers");
    v.accepts(data({ enable_autodetect: "0", autodetect_proxy_section: "missing" }));
});

t.test("Autodetect passes custom limits to sing-box in the right units", () => {
    let custom = data({ enable_autodetect: "1", autodetect_proxy_section: "main",
        autodetect_timeout: "20", autodetect_confirmations: "3", autodetect_stall_timeout: "30",
        autodetect_response_limit: "128", autodetect_recheck_interval: "60", autodetect_history_limit: "50" });
    v.accepts(custom, { sing_box_version: "1.14.4-r8" });
    fixture.seed(custom);
    t.eq(generator.build({ service_address: "127.0.0.1" }).experimental.clash_api.autodetect, {
        direct: "direct-out", proxy: "VPN Main", timeout: "20s", confirmations: 3,
        stall_timeout: "30s", response_limit: 131072, recheck_interval: "60m", history_limit: 50
    });
});

t.test("Autodetect refuses invalid limits before generating a core configuration", () => {
    for (let field in [
        [ "autodetect_timeout", "0" ], [ "autodetect_timeout", "61" ],
        [ "autodetect_confirmations", "6" ], [ "autodetect_stall_timeout", "2" ],
        [ "autodetect_response_limit", "1025" ], [ "autodetect_recheck_interval", "1441" ],
        [ "autodetect_history_limit", "9" ], [ "autodetect_timeout", "1.5" ],
        [ "autodetect_timeout", "8s" ]
    ]) {
        let settings = { enable_autodetect: "1", autodetect_proxy_section: "main", [field[0]]: field[1] };
        v.refuses(data(settings), field[0]);
    }
});

t.test("Autodetect requires r8 only when enabled", () => {
    let enabled = data({ enable_autodetect: "1", autodetect_proxy_section: "main" });
    for (let version in [ "", "1.14.4-r6", "1.14.4-r7", "1.14.4-r8~rc1" ])
        v.refuses(enabled, "Autodetect requires sing-box-forkop 1.14.4-r8", { sing_box_version: version });
    for (let version in [ "1.14.4-r8", "1.14.4-r9", "1.14.4-r10", "1.14.5-r1" ])
        v.accepts(enabled, { sing_box_version: version });
    for (let version in [ "1.14.4-r6", "1.14.4-r7" ]) {
        v.accepts(data(), { sing_box_version: version });
        v.accepts(data({ enable_autodetect: "0", autodetect_proxy_section: "main" }), { sing_box_version: version });
    }
    v.refuses(data({ enable_autodetect: "yes", autodetect_proxy_section: "main" }),
        "Autodetect requires sing-box-forkop 1.14.4-r8", { sing_box_version: "1.14.4-r7" });
});

t.test("Autodetect checks the version reported by the installed binary", () => {
    for (let version in [ "1.14.4-r7", "1.14.4-r8" ]) {
        fixture.seed(v.with_dns(data({ enable_autodetect: "1", autodetect_proxy_section: "main" })));
        let binary = features.paths.binary;
        features.paths.binary = stub.tmpdir() + "/sing-box";
        fs.writefile(features.paths.binary, "# " + version + "\n");
        stub.commands([
            [ features.paths.binary + " version", { stdout: "sing-box version " + version + "\nTags: with_clash_api\n" } ]
        ]);
        let error = null;
        try {
            validator.validate();
        }
        catch (e) {
            error = e.message;
        }
        stub.restore();
        features.paths.binary = binary;
        if (version == "1.14.4-r7")
            t.contains(error, "Autodetect requires sing-box-forkop 1.14.4-r8");
        else
            t.eq(error, null);
    }
});

t.test("custom HTTPS ports are passed to a supporting core, while port 443 remains compatible with r8", () => {
    let custom = data({ enable_autodetect: "1", autodetect_proxy_section: "main", autodetect_ports: [ "443", "8443", "08443" ] });
    v.refuses(custom, "ports other than 443 require sing-box-forkop 1.14.4-r9", { sing_box_version: "1.14.4-r8" });
    v.accepts(custom, { sing_box_version: "1.14.4-r9" });
    fixture.seed(custom);
    t.eq(generator.build({ service_address: "127.0.0.1" }).experimental.clash_api.autodetect.ports, [ 443, 8443 ]);
    let standard = data({ enable_autodetect: "1", autodetect_proxy_section: "main", autodetect_ports: [ "443", "0443" ] });
    v.accepts(standard, { sing_box_version: "1.14.4-r8" });
    fixture.seed(standard);
    t.eq(generator.build({ service_address: "127.0.0.1" }).experimental.clash_api.autodetect.ports, null);
    for (let port in [ "0", "65536", "443-8443", "443,8443", "tcp:443", "443; reboot", "1.5" ])
        v.refuses(data({ enable_autodetect: "1", autodetect_proxy_section: "main", autodetect_ports: [ port ] }), "autodetect_ports");
    v.accepts(data({ enable_autodetect: "0", autodetect_ports: [ "invalid" ] }), { sing_box_version: "1.14.4-r8" });
});

t.done();
