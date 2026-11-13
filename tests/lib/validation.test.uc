let t = require("t");
let fs = require("fs");
let stub = require("stub");
let features = require("singbox.features");
let v = require("validation");

t.test("configuration validation is independent of an installed core", () => {
    let binary = stub.tmpdir() + "/sing-box";
    features.paths.binary = binary;
    v.accepts({});
    fs.writefile(binary, "#!/bin/sh\n");
    v.accepts({});
    t.eq(features.paths.binary, binary);
    v.refuses({ settings: { dns_server: [ "invalid://dns.example.com" ] } }, "Invalid main DNS server");
    t.eq(features.paths.binary, binary, "a refused configuration also restores the binary path");
});

t.test("configuration validation checks explicitly supplied core tags", () => {
    let data = { settings: { dns_server: [ "quic://dns.example.com" ] } };
    v.refuses(data, "this sing-box build lacks QUIC", { core_tags: [ "with_clash_api" ] });
    v.accepts(data, { core_tags: [ "with_clash_api", "with_quic" ] });
});

t.done();
