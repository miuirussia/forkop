#!/usr/bin/env python3
"""Check generated Autodetect capture rules with packets in a private network namespace."""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]


def command(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout


def configure(enabled=True, ports=None, bypass=False, excluded_system=False):
    settings = {"source_network_interfaces": "lo", "enable_autodetect": "1" if enabled else "0",
                "routing_excluded_ips": "192.168.1.50 fd00::50" + (" @system" if excluded_system else "")}
    if ports is not None:
        settings["autodetect_ports"] = ports
    data = {"settings": settings, "section": [
        {".name": "bypass", "action": "bypass", "destinations": "1.1.1.1 2606:4700:4700::1111"}
    ] if bypass else []}
    code = 'require("fixture").seed(' + json.dumps(data) + '); print(require("nft.apply").build().script);'
    script = command("ucode", "-L", "tests/fakes", "-L", "tests/lib", "-L", "forkop/files/usr/lib", "-e", code, cwd=ROOT)
    if subprocess.run(["nft", "list", "table", "inet", "ForkopTable"], capture_output=True).returncode == 0:
        command("nft", "delete", "table", "inet", "ForkopTable")
    command("nft", "-f", "-", input=script)


def count(chain, name):
    rules = json.loads(command("nft", "-j", "list", "chain", "inet", "AutodetectTest", chain))["nftables"]
    return sum(expr["counter"]["packets"] for entry in rules
               if entry.get("rule", {}).get("comment") == name
               for expr in entry["rule"]["expr"] if "counter" in expr)


def checksum(data):
    data += b"\0" * (len(data) % 2)
    total = sum(struct.unpack("!" + "H" * (len(data) // 2), data))
    while total >> 16:
        total = (total & 65535) + (total >> 16)
    return (~total) & 65535


def incoming(family, source, destination, port=443, protocol=socket.IPPROTO_TCP):
    src, dst = socket.inet_pton(family, source), socket.inet_pton(family, destination)
    transport = (struct.pack("!HHIIBBHHH", 23456, port, 1, 0, 5 << 4, 2, 65535, 0, 0)
                 if protocol == socket.IPPROTO_TCP else struct.pack("!HHHH", 23456, port, 8, 0))
    pseudo = (src + dst + struct.pack("!BBH", 0, protocol, len(transport)) if family == socket.AF_INET
              else src + dst + struct.pack("!I3xB", len(transport), protocol))
    offset = 16 if protocol == socket.IPPROTO_TCP else 6
    transport = transport[:offset] + struct.pack("!H", checksum(pseudo + transport)) + transport[offset + 2:]
    if family == socket.AF_INET:
        header = struct.pack("!BBHHHBBH", 0x45, 0, 20 + len(transport), 1, 0, 64, protocol, 0) + src + dst
        packet = header[:10] + struct.pack("!H", checksum(header)) + header[12:] + transport
        ethertype = 0x0800
    else:
        packet = struct.pack("!IHBB", 6 << 28, len(transport), protocol, 64) + src + dst + transport
        ethertype = 0x86DD
    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW) as sock:
        sock.bind(("lo", 0))
        sock.send(b"\0" * 12 + struct.pack("!H", ethertype) + packet)


def outgoing(family, destination, port=443, mark=0):
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.05)
        if mark:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_MARK, mark)
        sock.connect_ex((destination, port))


def inside():
    command("ip", "link", "set", "lo", "up")
    command("ip", "route", "add", "default", "dev", "lo")
    command("ip", "-6", "route", "add", "default", "dev", "lo")
    command("nft", "-f", "-", input='''
add table inet AutodetectTest
add chain inet AutodetectTest incoming { type filter hook prerouting priority -110; }
add rule inet AutodetectTest incoming meta mark 0x04000000 counter comment "captured"
add rule inet AutodetectTest incoming counter drop
add chain inet AutodetectTest outgoing { type filter hook output priority -140; }
add rule inet AutodetectTest outgoing meta mark 0x10000000 counter comment "captured"
add rule inet AutodetectTest outgoing counter drop
''')
    for family, client, excluded, local, destination in [
        (socket.AF_INET, "192.168.1.2", "192.168.1.50", "127.0.0.1", "1.1.1.1"),
        (socket.AF_INET6, "fd00::2", "fd00::50", "fd00::1", "2606:4700:4700::1111"),
    ]:
        for enabled, ports, bypass, excluded_system in [
            (False, None, False, False), (True, None, False, False),
            (True, ["8443"], False, False), (True, None, True, False),
            (True, None, False, True),
        ]:
            configure(enabled, ports, bypass, excluded_system)
            for port in [443, 8443]:
                selected = enabled and not bypass and str(port) in (ports or ["443"])
                for source, target, protocol, expected in [
                    (client, destination, socket.IPPROTO_TCP, selected),
                    (excluded, destination, socket.IPPROTO_TCP, False),
                    (client, local, socket.IPPROTO_TCP, False),
                    (client, destination, socket.IPPROTO_UDP, False),
                ]:
                    before = count("incoming", "captured")
                    incoming(family, source, target, port, protocol)
                    assert (count("incoming", "captured") > before) == expected, (enabled, ports, bypass, source, target, port, protocol)
                for mark in [0, 0x08000000, 0x200]:
                    before = count("outgoing", "captured")
                    outgoing(family, destination, port, mark)
                    expected = selected and not excluded_system and mark == 0
                    assert (count("outgoing", "captured") > before) == expected, (enabled, ports, bypass, excluded_system, family, port, mark)
    print("Autodetect packet checks passed: IPv4/IPv6, ports, TCP only, device exclusions, bypass, local addresses and core/provider marks")


if "--inside" in sys.argv:
    inside()
else:
    namespaces = "-n" if os.geteuid() == 0 else "-Urn"
    subprocess.run(["unshare", namespaces, sys.executable, str(Path(__file__).resolve()), "--inside"], check=True)
