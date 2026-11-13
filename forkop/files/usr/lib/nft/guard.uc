// A separate table survives failed-runtime cleanup. Only a completed apply or an
// explicit Stop removes it; rebuilding ForkopTable must never open direct egress.
let common = require("core.common");
let constants = require("core.constants");
let exec = require("core.exec");
let uci = require("core.uci");
let ip = require("core.ip");
let connections = require("config.connections");
let nft = require("nft.apply");
let state = require("nft.state");

const TABLE = "ForkopGuard";

function script(settings, interfaces, flowtables, local) {
    let lines = [ "add table inet " + TABLE, "flush table inet " + TABLE ];
    let add = (chain, rule) => push(lines, "add rule inet " + TABLE + " " + chain + " " + rule);
    let excluded = connections.excluded_devices(settings);
    let list = (values) => "{ " + join(", ", values) + " }";
    push(lines, "add set inet " + TABLE + " interfaces { type ifname; flags interval; auto-merge; }");
    push(lines, "flush set inet " + TABLE + " interfaces");
    if (length(interfaces) > 0)
        push(lines, "add element inet " + TABLE + " interfaces " + list(map(uniq(interfaces), (name) => sprintf("%J", name))));
    for (let family in [ 4, 6 ]) {
        let name = "local" + family;
        push(lines, "add set inet " + TABLE + " " + name + " { type ipv" + family + "_addr; flags interval; auto-merge; }");
        push(lines, "flush set inet " + TABLE + " " + name);
        let prefixes = family == 4 ? nft.LOCAL4_RANGES : nft.LOCAL6_RANGES;
        push(lines, "add element inet " + TABLE + " " + name + " " + list([ ...prefixes, ...(local?.[family] ?? []) ]));
    }
    push(lines, "add chain inet " + TABLE + " scope");
    add("scope", "ct direction reply return");
    add("scope", "fib daddr type local return");
    add("scope", "ip daddr @local4 return");
    add("scope", "ip6 daddr @local6 return");
    add("scope", "counter drop");
    push(lines, "add chain inet " + TABLE + " ingress { type filter hook prerouting priority -199; policy accept; }");
    for (let value in excluded.addresses) {
        let family = ip.ip_family(value);
        if (family != 0)
            add("ingress", (family == 6 ? "ip6" : "ip") + " saddr " + value + " return");
    }
    add("ingress", "iifname @interfaces jump scope");
    // A WAN reply could re-add a flushed connection to fw4's bidirectional
    // flowtable. Drop it before FORWARD reaches the offload rule as well.
    push(lines, "add chain inet " + TABLE + " replies");
    add("replies", "ip saddr @local4 return");
    add("replies", "ip6 saddr @local6 return");
    for (let value in excluded.addresses) {
        let family = ip.ip_family(value);
        if (family != 0)
            add("replies", (family == 6 ? "ip6" : "ip") + " daddr " + value + " return");
    }
    add("replies", "counter drop");
    push(lines, "add chain inet " + TABLE + " forward { type filter hook forward priority -199; policy accept; }");
    add("forward", "ct direction reply oifname @interfaces jump replies");
    push(lines, "add chain inet " + TABLE + " output { type filter hook output priority -199; policy accept; }");
    if (!excluded.router) {
        // The core must still download providers. The resolver's upstream DNS is
        // deliberately direct in the normal table too, and is needed to bootstrap it.
        add("output", "meta mark & " + constants.NFT_OUTBOUND_MARK + " == " + constants.NFT_OUTBOUND_MARK + " return");
        add("output", "meta l4proto { tcp, udp } th dport 53 return");
        add("output", "jump scope");
    }
    // Evict connections previously forwarded directly: otherwise fw4's flowtable
    // would let them skip prerouting and the newly installed guard.
    for (let flowtable in flowtables)
        push(lines, "flush flowtable " + flowtable.family + " " + sprintf("%J", flowtable.table) + " " + sprintf("%J", flowtable.name));
    return join("\n", lines) + "\n";
}

function arm() {
    let settings = uci.get_all(constants.FORKOP_CONFIG_NAME, "settings") ?? {};
    let interfaces = common.words(common.option(settings, "source_network_interfaces", "br-lan"));
    // Keep the old capture and a guard left by a failed apply in scope until success.
    for (let table in [ constants.NFT_TABLE_NAME, TABLE ]) {
        if (!state.table_present(table))
            continue;
        let name = table == TABLE ? "interfaces" : constants.NFT_INTERFACE_SET_NAME;
        let reply = exec.combined([ "nft", "-j", "list", "set", "inet", table, name ]);
        let value = common.parse_json(reply.output);
        if (reply.status != 0 || type(value?.nftables) != "array")
            die("Failed to read the active Forkop interfaces for the traffic guard");
        for (let item in value.nftables)
            for (let name in item.set?.elem ?? []) {
                if (type(name) != "string")
                    die("Invalid active Forkop interface in the traffic guard");
                push(interfaces, name);
            }
    }
    let reply = exec.combined([ "nft", "-j", "list", "flowtables" ]);
    let value = common.parse_json(reply.output);
    if (reply.status != 0 || type(value?.nftables) != "array")
        die("Failed to list flowtables for the traffic guard");
    let flowtables = [];
    for (let item in value.nftables)
        if (item.flowtable != null) {
            let ft = item.flowtable;
            if (index([ "ip", "ip6", "inet", "bridge", "netdev" ], ft.family) < 0 || type(ft.table) != "string" || type(ft.name) != "string")
                die("Invalid flowtable in the traffic guard");
            push(flowtables, ft);
        }
    // Interface addresses include the on-link LAN prefixes even when those are
    // globally routable. Do not exempt the default route through a LAN gateway.
    reply = exec.combined([ state.IP_BIN, "-o", "addr", "show" ]);
    if (reply.status != 0)
        die("Failed to read the local prefixes for the traffic guard");
    let local = { "4": [], "6": [] };
    for (let line in split(reply.output, "\n")) {
        let fields = common.words(line);
        let family = fields[2] == "inet" ? 4 : fields[2] == "inet6" ? 6 : 0;
        if (family == 0 || ip.ip_family(fields[3]) != family)
            continue;
        let name = split(fields[1], "@")[0];
        for (let pattern in interfaces) {
            let prefix = substr(pattern, 0, length(pattern) - 1);
            if (name == pattern || (substr(pattern, -1) == "*" && substr(name, 0, length(prefix)) == prefix)) {
                push(local[family], fields[3]);
                break;
            }
        }
    }
    let result = exec.feed([ "nft", "-f", "-" ], script(settings, interfaces, flowtables, local));
    if (result.status != 0)
        die("Failed to block direct traffic while applying Forkop: " + nft.refusal(result));
}

function release() {
    if (state.table_present(TABLE) && !exec.ok([ "nft", "delete", "table", "inet", TABLE ]))
        die("Failed to remove the Forkop traffic guard");
}

function active() {
    return state.table_present(TABLE);
}

return { TABLE, script, arm, release, active };
