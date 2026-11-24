#!/usr/bin/env python3
"""Check router FakeIP connections without a WAN route and ahead of tunnel source rules."""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import threading
import time


ROOT = Path(__file__).resolve().parents[2]


def command(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout


def ucode(source):
    return command("ucode", "-L", "tests/fakes", "-L", "tests/lib", "-L", "forkop/files/usr/lib",
                   "-e", source, cwd=ROOT)


def configure(excluded_system=False):
    settings = {"source_network_interfaces": "lan-test",
                "routing_excluded_ips": "192.168.1.50 fd00::50" + (" @system" if excluded_system else "")}
    # Use the real setup and state queries against a numeric table in this namespace.
    ucode('require("core.constants").RT_TABLE_NAME = "105"; '
          'require("fixture").seed({settings:' + json.dumps(settings) + '}); '
          'let nft = require("nft.apply"); nft.paths.rt_tables = require("stub").tmpdir() + "/rt_tables"; '
          'nft.apply(nft.build()); '
          'if (!require("nft.state").runtime_network_configured("ForkopTable", "105", "0x04000000")) die("unhealthy routing");')


def count(chain):
    rules = json.loads(command("nft", "-j", "list", "chain", "inet", "FakeIPTest", chain))["nftables"]
    return sum(expr["counter"]["packets"] for item in rules
               for expr in item.get("rule", {}).get("expr", []) if "counter" in expr)


def incoming(family, source, target):
    def checksum(data):
        total = sum(struct.unpack("!" + "H" * (len(data) // 2), data))
        while total >> 16:
            total = (total & 65535) + (total >> 16)
        return (~total) & 65535

    src, dst = socket.inet_pton(family, source), socket.inet_pton(family, target)
    tcp = struct.pack("!HHIIBBHHH", 23456, 18080, 1, 0, 5 << 4, 2, 65535, 0, 0)
    pseudo = (src + dst + struct.pack("!BBH", 0, 6, len(tcp)) if family == socket.AF_INET
              else src + dst + struct.pack("!I3xB", len(tcp), 6))
    tcp = tcp[:16] + struct.pack("!H", checksum(pseudo + tcp)) + tcp[18:]
    if family == socket.AF_INET:
        header = struct.pack("!BBHHHBBH", 0x45, 0, 20 + len(tcp), 1, 0, 64, 6, 0) + src + dst
        packet = header[:10] + struct.pack("!H", checksum(header)) + header[12:] + tcp
        protocol = 0x0800
    else:
        packet = struct.pack("!IHBB", 6 << 28, len(tcp), 6, 64) + src + dst + tcp
        protocol = 0x86DD
    addresses = [bytes.fromhex(json.loads(command("ip", "-j", "link", "show", "dev", name))[0]["address"].replace(":", ""))
                 for name in ["lan-test", "client-test"]]
    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW) as sock:
        sock.bind(("client-test", 0))
        sock.send(b"".join(addresses) + struct.pack("!H", protocol) + packet)


def check_packet(chain, send, label):
    before = {name: count(name) for name in ["input", "forward", "egress"]}
    send()
    deadline = time.monotonic() + 1
    while count(chain) == before[chain] and time.monotonic() < deadline:
        time.sleep(0.01)
    after = {name: count(name) for name in before}
    assert after[chain] > before[chain], (label, before, after)
    for other in before.keys() - {chain}:
        assert after[other] == before[other], (label, "unexpected packet path", before, after)


def inside():
    command("ip", "link", "set", "lo", "up")
    Path("/proc/sys/net/ipv4/conf/all/rp_filter").write_text("0")
    Path("/proc/sys/net/ipv4/conf/lo/rp_filter").write_text("0")
    configure()

    for family, flag, source, target, bind, transparent, level in [
        (socket.AF_INET, "-4", "192.0.2.1", "198.18.0.1", "0.0.0.0", 19, socket.SOL_IP),
        (socket.AF_INET6, "-6", "2001:db8::1", "2001:2::1", "::1", 75, socket.IPPROTO_IPV6),
    ]:
        command("ip", flag, "addr", "add", source + ("/32" if family == socket.AF_INET else "/128"), "dev", "lo")
        for bound_source, tunnel_policy in [(False, False), (True, False), (False, True), (True, True)]:
            if tunnel_policy:
                # The core's kernel tunnels install source rules at 101, before mark rule 105.
                command("ip", flag, "route", "replace", "unreachable", "default", "table", "1066")
                selected_source = source if bound_source else ("127.0.0.1" if family == socket.AF_INET else "::1")
                command("ip", flag, "rule", "add", "from", selected_source, "lookup", "1066", "priority", "101")
            with socket.socket(family, socket.SOCK_STREAM) as listener:
                listener.setsockopt(level, transparent, 1)
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                if family == socket.AF_INET6:
                    listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                listener.bind((bind, 1604))
                listener.listen(1)
                listener.settimeout(3)
                errors = []

                def connect():
                    try:
                        with socket.socket(family, socket.SOCK_STREAM) as client:
                            client.settimeout(3)
                            if bound_source:
                                client.bind((source, 0))
                            client.connect((target, 443))
                            assert client.recv(32) == b"fakeip-ok"
                    except Exception as error:
                        errors.append(error)

                thread = threading.Thread(target=connect)
                thread.start()
                try:
                    connection, _ = listener.accept()
                    with connection:
                        connection.sendall(b"fakeip-ok")
                finally:
                    thread.join()
                assert not errors, (flag, bound_source, tunnel_policy, errors)
        # No default route was needed or added to the main table.
        assert not command("ip", flag, "route", "show", "default")
    print("FakeIP TCP checks passed: IPv4/IPv6, bound/unbound sockets, no WAN default, tunnel source policies")

    before = [command("ip", flag, "rule", "list", "table", "105") for flag in ["-4", "-6"]]
    configure()
    assert before == [command("ip", flag, "rule", "list", "table", "105") for flag in ["-4", "-6"]], "setup added duplicate rules"
    for flag, prefix in [("-4", "198.18.0.0/16"), ("-6", "2001:2::/112")]:
        command("ip", flag, "rule", "add", "to", prefix, "lookup", "105", "priority", "99")
    healthy = ucode('print(require("nft.state").runtime_network_configured("ForkopTable", "105", "0x04000000"));')
    assert healthy == "false", "health accepted surviving unscoped rules"
    configure()
    assert before == [command("ip", flag, "rule", "list", "table", "105") for flag in ["-4", "-6"]], "legacy rules survived upgrade"

    Path("/proc/sys/net/ipv4/ip_forward").write_text("1")
    Path("/proc/sys/net/ipv6/conf/all/forwarding").write_text("1")
    command("ip", "link", "add", "lan-test", "type", "veth", "peer", "name", "client-test")
    command("ip", "link", "add", "wan-test", "type", "dummy")
    for device in ["lan-test", "client-test", "wan-test"]:
        command("ip", "link", "set", device, "up")
    for flag, lan, wan, prefix, target, excluded in [
        ("-4", "192.168.1.1/24", "192.0.2.2/24", "198.18.0.0/16", "198.18.0.2", "192.168.1.50"),
        ("-6", "fd00::1/64", "2001:db8:1::2/64", "2001:2::/112", "2001:2::2", "fd00::50"),
    ]:
        command("ip", flag, "addr", "add", lan, "dev", "lan-test", *(["nodad"] if flag == "-6" else []))
        command("ip", flag, "addr", "add", wan, "dev", "wan-test", "nodad" if flag == "-6" else "noprefixroute")
        command("ip", flag, "route", "add", prefix, "dev", "wan-test")
        route = json.loads(command("ip", flag, "-j", "route", "get", target, "from", excluded, "iif", "lan-test"))[0]
        assert route["dev"] == "wan-test" and route.get("type") != "local", ("excluded LAN was rerouted locally", flag, route)

    command("nft", "-f", "-", input='''
add table inet FakeIPTest
add chain inet FakeIPTest input { type filter hook input priority -1; }
add rule inet FakeIPTest input ip daddr 198.18.0.0/16 counter drop
add rule inet FakeIPTest input ip6 daddr 2001:2::/112 counter drop
add chain inet FakeIPTest forward { type filter hook forward priority -1; }
add rule inet FakeIPTest forward iifname lan-test counter drop
add chain inet FakeIPTest egress { type filter hook postrouting priority 101; }
add rule inet FakeIPTest egress oifname wan-test tcp dport 18080 counter drop
''')
    for excluded_system in [False, True, False]:
        configure(excluded_system)
        for family, target, client, excluded, bind, level, transparent in [
            (socket.AF_INET, "198.18.0.2", "192.168.1.2", "192.168.1.50", "0.0.0.0", socket.SOL_IP, 19),
            (socket.AF_INET6, "2001:2::2", "fd00::2", "fd00::50", "::1", socket.IPPROTO_IPV6, 75),
        ]:
            # A real TProxy listener is necessary for the kernel to accept captured SYNs.
            with socket.socket(family, socket.SOCK_STREAM) as listener:
                listener.setsockopt(level, transparent, 1)
                if family == socket.AF_INET6:
                    listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                listener.bind((bind, 1602))
                listener.listen(1)
                check_packet("forward", lambda: incoming(family, excluded, target), (family, "excluded LAN"))
                check_packet("input", lambda: incoming(family, client, target), (family, "captured LAN", excluded_system))
            for mark in ([0, 0x08000000, 0x08000100] if excluded_system else [0x08000000, 0x08000100]):
                def connect():
                    with socket.socket(family, socket.SOCK_STREAM) as sock:
                        sock.settimeout(0.05)
                        sock.setsockopt(socket.SOL_SOCKET, socket.SO_MARK, mark)
                        sock.connect_ex((target, 18080))
                check_packet("egress", connect, (family, "excluded System/core", excluded_system, mark))
    print("FakeIP exclusions passed: IPv4/IPv6 LAN capture and exclusions, System toggles, core mark masks, idempotence and legacy upgrade")


if "--inside" in sys.argv:
    inside()
else:
    namespaces = "-n" if os.geteuid() == 0 else "-Urn"
    subprocess.run(["unshare", namespaces, sys.executable, str(Path(__file__).resolve()), "--inside"], check=True)
