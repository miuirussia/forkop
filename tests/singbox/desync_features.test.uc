let t = require("t");
let fs = require("fs");
let stub = require("stub");
let features = require("singbox.features");

function core(version, caps, status) {
    features.paths.binary = stub.tmpdir() + "/sing-box";
    fs.writefile(features.paths.binary, version + sprintf("%J", caps));
    stub.commands([
        [ features.paths.binary + " version", { stdout: "sing-box version " + version + "\nTags: with_clash_api\n" } ],
        [ features.paths.binary + " desync capabilities", { status: status ?? 0, stdout: sprintf("%J", caps) } ]
    ]);
}

t.test("an older core cannot claim Desync support with a build tag", () => {
    core("1.14.4-r17", { capability: "forkop-desync-v1" });
    t.eq(features.available("desync", [ "with_desync" ]), false);
    t.eq(features.desync_capabilities(), null);
    t.eq(length(stub.calls()), 1, "no unsupported CLI invocation on an old release");
    stub.restore();
});

t.test("a newer upstream version does not impersonate a Forkop release", () => {
    core("1.15.0", null, 1);
    t.eq(features.available("desync"), false);
    t.eq(length(stub.calls()), 1);
    stub.restore();
});

t.test("r18 asks the capability CLI once per binary and exposes the actual report", () => {
    let caps = { capability: "forkop-desync-v1", supported: true, unsupported: { some_option: "kernel reason" } };
    core("1.14.4-r18", caps);
    t.ok(features.available("desync"));
    t.eq(features.desync_capabilities(), caps);
    t.eq(features.report().desync.capabilities, caps);
    t.eq(length(stub.calls()), 2);
    stub.restore();
});

t.test("explicit capability denial or malformed JSON is refused; absent CLI keeps the release guard", () => {
    core("1.14.4-r18", { capability: "forkop-desync-v1", supported: false });
    t.eq(features.available("desync"), false);
    core("1.14.4-r18", { capability: "unrelated" });
    t.eq(features.available("desync"), false);
    core("1.14.4-r18", null, 1);
    t.eq(features.available("desync"), true);
    t.eq(features.desync_capabilities(), null);
    stub.restore();
});

t.done();
