let t = require("t");
let fixture = require("fixture");
let generator = require("singbox.generator");
let q = require("sbconfig");
let v = require("validation");
function data(obf) {
    return {
        section: [ { ".name": "vpn", enabled: "1", action: "connection" } ],
        tunnel: [ { ".name": "phobos", section: "vpn", kind: "phobos", name: "Phobos",
            address: [ "10.8.0.2/32" ], private_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            phobos_obfuscation: sprintf("%J", obf) } ],
        tunnel_peer: [ { ".name": "peer", tunnel: "phobos", address: "vpn.example.com", port: "51824",
            public_key: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=", allowed_ips: [ "0.0.0.0/0" ] } ]
    };
}
t.test("Phobos validates and generates a native endpoint preserving zeros", () => {
    let obf = { key: "test", masking: "MEDIA", max_dummy: 0, obfuscate_bytes: 0 };
    v.accepts(data(obf));
    fixture.seed(data(obf));
    let config = generator.build({ service_address: "127.0.0.1" });
    let endpoint = q.endpoint(config, "vpn/Phobos");
    t.eq(endpoint.type, "phobos");
    t.eq(endpoint.obfuscation, obf);
    t.eq(endpoint.peers[0].address, "vpn.example.com");
});
t.test("Phobos refuses invalid obfuscation before starting the core", () => {
    for (let obf in [ {}, { key: "test", masking: "TLS" }, { key: "test", max_dummy: 1025 } ])
        v.refuses(data(obf), "invalid Phobos");
});
t.test("a saved Phobos connection_link becomes an endpoint rather than a parser outbound", () => {
    let d = data({ key: "test" });
    delete d.tunnel; delete d.tunnel_peer;
    let conf = "[Interface]\nPrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nAddress = 10.8.0.2/32\nMTU = none\n[Peer]\nPublicKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\nAllowedIPs = 0.0.0.0/0\nEndpoint = 127.0.0.1:13255\n[instance]\ntarget = vpn.example.com:51824\nkey = test\nmasking = MEDIA\nmax-dummy = 0\n";
    let encoded = replace(replace(replace(b64enc(conf), /\+/g, "-"), /\//g, "_"), /=+$/, "");
    d.connection_link = [ { ".name": "saved", section: "vpn", name: "work", uri: "phobos://" + encoded + "#work" } ];
    v.accepts(d);
    fixture.seed(d);
    let config = generator.build({ service_address: "127.0.0.1" });
    let endpoint = q.endpoint(config, "vpn/work");
    t.eq(endpoint.type, "phobos");
    t.eq(endpoint.obfuscation.max_dummy, 0);
    t.eq(endpoint.peers[0].address, "vpn.example.com");
    t.eq(length(filter(config.outbounds, (outbound) => outbound.type == "parser")), 0);
    t.contains(q.outbound(config, "vpn").outbounds, "vpn/work");
    d.connection_link[0].uri = "phobos://broken";
    v.refuses(d, "Invalid Phobos");
});
t.done();
