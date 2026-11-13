let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let guard = require("nft.guard");
let state = require("nft.state");

t.test("the guard blocks IPv4 and IPv6 before capture, preserving LAN, excluded devices, and core downloads", () => {
    let text = guard.script({ routing_excluded_ips: "192.168.1.50 2001:db8::50" }, [ "br-lan", "tun0" ], []);
    t.contains(text, "hook prerouting priority -199");
    t.contains(text, "hook output priority -199");
    t.contains(text, 'interfaces { "br-lan", "tun0" }');
    t.contains(text, "ingress ip saddr 192.168.1.50 return");
    t.contains(text, "ingress ip6 saddr 2001:db8::50 return");
    t.contains(text, "scope fib daddr type local return");
    t.contains(text, "scope ip daddr @local4 return");
    t.contains(text, "scope ip6 daddr @local6 return");
    t.contains(text, "scope counter drop");
    t.contains(text, "hook forward priority -199");
    t.contains(text, "forward ct direction reply oifname @interfaces jump replies");
    t.contains(text, "replies ip saddr @local4 return");
    t.contains(text, "replies ip6 saddr @local6 return");
    t.contains(text, "replies ip daddr 192.168.1.50 return");
    t.contains(text, "replies ip6 daddr 2001:db8::50 return");
    t.contains(text, "replies counter drop");
    t.contains(text, "output meta mark & 0x08000000 == 0x08000000 return");
    t.contains(text, "output meta l4proto { tcp, udp } th dport 53 return");
    t.excludes(guard.script({ routing_excluded_ips: "@system" }, [], []), "output jump scope");
});

t.test("arming preserves old interfaces and local prefixes, including wildcard interfaces but not the WAN", () => {
    fixture.seed({ settings: { source_network_interfaces: "br-n*" } });
    let real_present = state.table_present;
    state.table_present = () => true;
    let written = "";
    stub.commands([
        [ "nft -j list set inet ForkopTable", { stdout: '{"nftables":[{"set":{"elem":["br-old"]}}]}' } ],
        [ "nft -j list set inet ForkopGuard", { stdout: '{"nftables":[{"set":{"elem":["br-held"]}}]}' } ],
        [ "nft -j list flowtables", { stdout: '{"nftables":[{"flowtable":{"family":"inet","table":"fw4","name":"ft"}}]}' } ],
        [ "/sbin/ip -o addr show", { stdout: "2: br-new@if3 inet6 2001:4860:1::1/64 scope global\n" +
            "2: br-new inet 192.168.1.1/24 scope global br-new\n" +
            "3: br-old inet6 2001:4860:2::1/64 scope global\n" +
            "4: eth0 inet6 2a00:1450::1/64 scope global\n" } ],
        [ "nft -f -", {} ]
    ]);
    guard.arm();
    written = stub.calls()[4].stdin;
    stub.restore();
    state.table_present = real_present;
    t.contains(written, 'interfaces { type ifname; flags interval; auto-merge; }');
    t.contains(written, 'interfaces { "br-n*", "br-old", "br-held" }');
    t.contains(written, "2001:4860:1::1/64");
    t.contains(written, "2001:4860:2::1/64");
    t.contains(written, "192.168.1.1/24");
    t.excludes(written, "2a00:1450::1/64");
    t.contains(written, 'flush flowtable inet "fw4" "ft"');
    t.excludes(written, "delete table inet ForkopTable");
});

t.test("an unreadable address inventory aborts before changing the running rules", () => {
    fixture.seed({ settings: {} });
    let real_present = state.table_present;
    state.table_present = () => false;
    stub.commands([
        [ "nft -j list flowtables", { stdout: '{"nftables":[]}' } ],
        [ "/sbin/ip -o addr show", { status: 1 } ]
    ]);
    t.contains(t.throws(() => guard.arm()).message, "Failed to read the local prefixes");
    t.eq(length(stub.calls()), 2);
    stub.restore();
    state.table_present = real_present;
});

t.test("an unreadable offload inventory aborts before touching the running rules", () => {
    fixture.seed({ settings: {} });
    let real_present = state.table_present;
    state.table_present = () => false;
    stub.commands([ [ "nft -j list flowtables", { status: 1 } ] ]);
    t.contains(t.throws(() => guard.arm()).message, "Failed to list flowtables");
    t.eq(length(stub.calls()), 1);
    stub.restore();
    state.table_present = real_present;
});

t.test("the guard is removed only by an explicit release, and deletion failure is reported", () => {
    let real_present = state.table_present;
    state.table_present = () => true;
    stub.commands([ [ "nft delete table inet ForkopGuard", { status: 1 } ] ]);
    t.contains(t.throws(() => guard.release()).message, "Failed to remove");
    stub.restore();
    state.table_present = real_present;
});

t.done();
