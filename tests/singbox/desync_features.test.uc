let t = require("t");
let fs = require("fs");
let stub = require("stub");
let features = require("singbox.features");
let caps = json(fs.readfile(require("repo").path("tests/fixtures/desync_capabilities.json")));

function core(version, caps, status) {
    features.paths.binary = stub.tmpdir() + "/sing-box";
    fs.writefile(features.paths.binary, version + sprintf("%J", caps));
    stub.commands([
        [ features.paths.binary + " version", { stdout: "sing-box version " + version + "\nTags: with_clash_api\n" } ],
        [ features.paths.binary + " desync capabilities", { status: status ?? 0, stdout: sprintf("%J", caps) } ]
    ]);
}

t.test("an older core cannot claim Desync support with a build tag", () => {
    for (let version in [ "1.14.4-r17", "1.14.4-r18", "1.14.4-r19" ]) {
        core(version, { capability: "forkop-desync-v1" });
        t.eq(features.available("desync", [ "with_desync" ]), false);
        t.eq(features.desync_capabilities(), null);
        t.eq(length(stub.calls()), 1, "no unsupported CLI invocation on an old release");
        stub.restore();
    }
});

t.test("a newer upstream version does not impersonate a Forkop release", () => {
    core("1.15.0", null, 1);
    t.eq(features.available("desync"), false);
    t.eq(length(stub.calls()), 1);
    stub.restore();
});

t.test("r20 asks the capability CLI once per binary and exposes the actual report", () => {
    core("1.14.4-r20", caps);
    t.ok(features.available("desync"));
    t.eq(features.desync_capabilities(), caps);
    t.eq(features.report().desync.capabilities, caps);
    t.eq(length(stub.calls()), 2);
    stub.restore();
});

t.test("missing, incomplete and denied capabilities are refused even on the required release", () => {
    core("1.14.4-r20", { capability: "forkop-desync-v1", supported: false });
    t.eq(features.available("desync"), false);
    core("1.14.4-r20", { capability: "unrelated" });
    t.eq(features.available("desync"), false);
    core("1.14.4-r20", null, 1);
    t.eq(features.available("desync"), false);
    t.eq(features.desync_capabilities(), null);
    for (let value in [ {}, { capability: "forkop-desync-v1", supported: true }, { ...caps, version: 0 }, { ...caps, parameters: [] } ]) {
        core("1.14.4-r20", value);
        t.eq(features.available("desync"), false);
    }
    stub.restore();
});

t.test("r20 capabilities require complete tables and typed support entries", () => {
    let contract = json(fs.readfile(require("repo").path("tests/fixtures/desync_extensions.json")));
    for (let overrides in contract.capability_overrides_rejected)
        t.eq(features.desync_capabilities_supported({ ...caps, ...overrides }), false, sprintf("%J", overrides));
    for (let table in [ "parameters", "mode_support" ]) {
        for (let key in keys(caps[table])) {
            let entries = { ...caps[table] };
            delete entries[key];
            let value = { ...caps };
            value[table] = entries;
            t.eq(features.desync_capabilities_supported(value), false, table + "." + key);
        }
        for (let entry in contract.capability_entries_rejected) {
            let value = { ...caps };
            value[table] = { ...caps[table] };
            value[table][keys(caps[table])[0]] = entry;
            t.eq(features.desync_capabilities_supported(value), false, sprintf("%s: %J", table, entry));
        }
    }
    t.ok(features.desync_capabilities_supported({ ...caps, protocols: [ "tls", "http" ] }));
    t.ok(features.desync_capabilities_supported({ ...caps, parameters: { ...caps.parameters, wscale: { supported: false, requirements: "Linux" } } }));
});

t.done();
