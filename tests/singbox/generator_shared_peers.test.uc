let t = require("t");
let fixture = require("fixture");
let q = require("sbconfig");
let generator = require("singbox.generator");

function build(data) {
    fixture.seed(data);
    return generator.build({ service_address: "127.0.0.1" });
}

function refused(data) {
    return t.throws(() => build(data)).message;
}

function section(name, label, extra) {
    return { ".name": name, label, enabled: "1", action: "connection", destinations: name + ".example", ...(extra ?? {}) };
}

function awg(name, owner, extra) {
    return {
        ".name": name, section: owner, order: "0", kind: "amneziawg", name: "awg",
        address: [ "10.8.1.5/32" ], private_key: "client-key", mtu: "1280",
        amnezia_jc: "5", amnezia_s4: "12", amnezia_random_trailers: "1",
        ...(extra ?? {})
    };
}

function peer(name, tunnel, extra) {
    return {
        ".name": name, tunnel, order: "0", address: "203.0.113.1", port: "42726",
        public_key: "server-key", allowed_ips: [ "0.0.0.0/0" ], persistent_keepalive_interval: "25-35",
        ...(extra ?? {})
    };
}

function one_server_in_two_sections(changes) {
    let data = {
        settings: fixture.settings(),
        section: [ section("proxy", "Proxy"), section("test", "Test"), section("hop", "Hop") ],
        connection_link: fixture.links("hop", [ "socks://127.0.0.1:1080#hop" ]),
        tunnel: [ awg("tun_proxy", "proxy"), awg("tun_test", "test") ],
        tunnel_peer: [ peer("peer_proxy", "tun_proxy"), peer("peer_test", "tun_test") ]
    };
    if (changes)
        changes(data);
    return data;
}

t.test("one AmneziaWG server in two sections stays an endpoint of each", () => {
    let config = build(one_server_in_two_sections());
    for (let tag in [ "Proxy/awg", "Test/awg" ]) {
        let endpoint = q.endpoint(config, tag);
        t.eq(endpoint.type, "amneziawg", tag);
        t.eq(endpoint.private_key, "client-key", tag);
        t.eq([ endpoint.system, endpoint.kernel, endpoint.name ], [ null, null, null ], tag);
    }
});

t.test("native WireGuard modes set endpoint flags and share an interface where needed", () => {
    for (let mode, expected in {
        userspace: [ false, null, null ],
        system: [ true, null, "forkop-wg0" ],
        kernel: [ null, true, "forkop-wg0" ]
    }) {
        let config = build(one_server_in_two_sections((data) => {
            for (let tunnel in data.tunnel)
                tunnel.wireguard_mode = mode;
        }));
        for (let tag in [ "Proxy/awg", "Test/awg" ]) {
            let endpoint = q.endpoint(config, tag);
            t.eq([ endpoint.system, endpoint.kernel, endpoint.name ], expected, mode);
        }
    }
});

t.test("one key for one server with another detour is refused, naming both endpoints", () => {
    let message = refused(one_server_in_two_sections((data) => {
        data.tunnel[1].detour_section = "hop";
    }));
    t.contains(message, "'Proxy/awg'");
    t.contains(message, "'Test/awg'");
    t.contains(message, "different detour");
});

t.test("one key for one server with another MTU or obfuscation is refused", () => {
    t.contains(refused(one_server_in_two_sections((data) => { data.tunnel[1].mtu = "1420"; })), "different mtu");
    t.contains(refused(one_server_in_two_sections((data) => { data.tunnel[1].amnezia_s4 = "16"; })), "different amnezia");
    t.contains(refused(one_server_in_two_sections((data) => { data.tunnel_peer[1].port = "51820"; })), "different peers");
});

t.test("one client key for two servers is two peers and allowed", () => {
    let config = build(one_server_in_two_sections((data) => {
        data.tunnel[1].mtu = "1420";
        data.tunnel_peer[1].public_key = "other-server-key";
    }));
    t.eq(q.endpoint(config, "Test/awg").mtu, 1420);
});

t.test("a JSON endpoint with default flags written explicitly matches a tunnel", () => {
    let config = build(one_server_in_two_sections((data) => {
        data.tunnel[1] = {
            ".name": "tun_test", section: "test", order: "0", kind: "json",
            endpoint_json: sprintf("%J", {
                tag: "awg", peers: [ { persistent_keepalive_interval: "25-35", allowed_ips: [ "0.0.0.0/0" ], public_key: "server-key", port: 42726, address: "203.0.113.1" } ],
                amnezia: { random_trailers: true, s4: 12, jc: 5 },
                mtu: 1280, private_key: "client-key", address: [ "10.8.1.5/32" ], type: "amneziawg", system: false
            })
        };
        data.tunnel_peer = [ data.tunnel_peer[0] ];
    }));
    let endpoint = q.endpoint(config, "Test/awg");
    t.eq(endpoint.type, "amneziawg");
    t.eq([ endpoint.system, endpoint.kernel, endpoint.name ], [ false, null, null ]);
    t.eq(q.endpoint(config, "Proxy/awg").system, null);
});

t.test("explicit JSON system, kernel and interface name options are honored", () => {
    let config = build(one_server_in_two_sections((data) => {
        for (let tunnel in data.tunnel)
            tunnel.wireguard_mode = "system";
        for (let name, options in {
            userspace: { system: false },
            custom: { name: "forkop-wg0", kernel: true },
            fallback: { system: true, kernel: true }
        })
            push(data.tunnel, {
                ".name": "tun_" + name, section: "test", kind: "json",
                endpoint_json: sprintf("%J", { type: "wireguard", tag: name, ...options })
            });
    }));
    t.eq(q.endpoint(config, "Test/userspace").system, false);
    t.eq(q.endpoint(config, "Test/userspace").name, null);
    let custom = q.endpoint(config, "Test/custom");
    t.eq([ custom.system, custom.kernel, custom.name ], [ null, true, "forkop-wg0" ]);
    t.eq(q.endpoint(config, "Proxy/awg").name, "forkop-wg1");
    let fallback = q.endpoint(config, "Test/fallback");
    t.eq([ fallback.system, fallback.kernel, fallback.name ], [ true, true, "forkop-wg2" ]);
});

function warp(name, owner, extra) {
    return { ".name": name, section: owner, order: "0", kind: "warp", name: "warp", ...(extra ?? {}) };
}

const WARP_PROFILE = { warp_profile_id: "id", warp_profile_auth_token: "token", warp_profile_private_key: "warp-key" };

t.test("one WARP profile key with other settings is refused, registered profiles are not", () => {
    t.contains(refused({
        settings: fixture.settings(),
        section: [ section("proxy", "Proxy"), section("test", "Test") ],
        tunnel: [ warp("warp_proxy", "proxy", WARP_PROFILE), warp("warp_test", "test", { ...WARP_PROFILE, warp_port: "2408" }) ]
    }), "different port");
    let config = build({
        settings: fixture.settings(),
        section: [ section("proxy", "Proxy"), section("test", "Test") ],
        tunnel: [ warp("warp_proxy", "proxy"), warp("warp_test", "test", { warp_port: "2408" }) ]
    });
    t.eq(q.endpoint(config, "Test/warp").port, 2408);
});

t.test("sections sharing a System or Kernel WARP profile use a single endpoint even with automatic ports", () => {
    for (let mode in [ "system", "kernel" ]) {
        let profile = { ...WARP_PROFILE, wireguard_mode: mode };
        fixture.seed({
            settings: fixture.settings(),
            section: [ section("proxy", "Proxy"), section("test", "Test") ],
            tunnel: [ warp("warp_proxy", "proxy", profile), warp("warp_test", "test", profile) ]
        });
        for (let bootstrap in [ false, true ]) {
            let config = generator.build({ service_address: "127.0.0.1", bootstrap });
            t.eq(length(config.endpoints), 1, mode);
            let endpoint = config.endpoints[0];
            t.eq(endpoint.tag, "Proxy/warp");
            t.eq(endpoint.name, "forkop-wg0");
            t.eq(endpoint.port, null, "the caller can still use the profile's automatic ports");
            t.eq(q.outbound(config, "Test/warp"), { type: "selector", tag: "Test/warp", outbounds: [ "Proxy/warp" ] });
            t.contains(q.outbound(config, "Test").outbounds, "Test/warp");
        }
    }
});

t.done();
