#!/usr/bin/env python3
"""Run with ucode, nft and ip on PATH; all packet tests run in a private user/net namespace."""
import argparse
import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import threading


def command(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout


def send(family, destination, port=443, mark=0, blocked=False):
    with socket.socket(family, socket.SOCK_DGRAM) as sock:
        if mark:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_MARK, mark)
        try:
            sock.sendto(b"guard-test", (destination, port))
        except OSError as error:
            assert blocked and error.errno == errno.EPERM, error
        else:
            assert not blocked, f"direct egress was allowed to {destination}"


def drops(chain="scope", table="ForkopGuard"):
    rules = json.loads(command("nft", "-j", "list", "chain", "inet", table, chain))
    return sum(expr["counter"]["packets"] for item in rules["nftables"]
               for expr in item.get("rule", {}).get("expr", []) if "counter" in expr)


def inject(family, source, destination):
    def checksum(data):
        data += b"\0" * (len(data) % 2)
        total = sum(struct.unpack("!" + "H" * (len(data) // 2), data))
        while total >> 16:
            total = (total & 65535) + (total >> 16)
        return (~total) & 65535

    src, dst = socket.inet_pton(family, source), socket.inet_pton(family, destination)
    udp = struct.pack("!HHHH", 23456, 443, 9, 0) + b"a"
    if family == socket.AF_INET6:
        pseudo = src + dst + struct.pack("!I3xB", len(udp), 17)
        udp = udp[:6] + struct.pack("!H", checksum(pseudo + udp)) + udp[8:]
        packet = struct.pack("!IHBB", 6 << 28, len(udp), 17, 64) + src + dst + udp
        protocol = 0x86DD
    else:
        header = struct.pack("!BBHHHBBH", 0x45, 0, 20 + len(udp), 1, 0, 64, 17, 0) + src + dst
        packet = header[:10] + struct.pack("!H", checksum(header)) + header[12:] + udp
        protocol = 0x0800
    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW) as sock:
        sock.bind(("lo", 0))
        sock.send(b"\0" * 12 + struct.pack("!H", protocol) + packet)


def fetch_behind_guard(core, directory):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/source.dat")
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"valid-dat")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_port
    command("nft", "insert", "rule", "inet", "ForkopGuard", "scope",
            "ct", "direction", "original", "tcp", "dport", str(port), "counter", "drop")
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        output = Path(directory) / "download.dat"
        args = [core, "geodata", "fetch", "--url", f"http://127.0.0.1:{port}/redirect", "--output", str(output)]
        before = drops()
        try:
            refused = subprocess.run(args, capture_output=True, text=True, timeout=1)
            assert refused.returncode != 0, "unmarked DAT fetch bypassed the guard"
        except subprocess.TimeoutExpired:
            pass  # TCP retries a dropped SYN until the fetch deadline expires.
        assert drops() > before and not output.exists(), "unmarked DAT fetch did not hit the guard"
        for _ in range(2):
            command(*args, "--routing-mark", "0x08000000", timeout=10)
            assert output.read_bytes() == b"valid-dat", "marked DAT fetch or retry failed behind the guard"
        print("Marked DAT fetch and retry passed behind the guard, including HTTP redirects")
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def forwarded_replies(directory):
    Path("/proc/sys/net/ipv4/ip_forward").write_text("1")
    Path("/proc/sys/net/ipv4/conf/all/rp_filter").write_text("0")
    Path("/proc/sys/net/ipv4/conf/lo/rp_filter").write_text("0")
    Path("/proc/sys/net/ipv6/conf/all/forwarding").write_text("1")
    command("ip", "link", "add", "br-test", "type", "bridge")
    command("ip", "link", "set", "br-test", "up")
    command("ip", "route", "add", "192.168.1.0/24", "dev", "br-test")
    command("ip", "-6", "route", "add", "2001:db8::/64", "dev", "br-test")
    command("ip", "route", "add", "1.1.1.1/32", "dev", "br-test")
    command("ip", "-6", "route", "add", "2606:4700:4700::1111/128", "dev", "br-test")
    command("nft", "-f", str(Path(directory) / "replies.nft"))
    # Seed confirmed connections from nonlocal client addresses through OUTPUT.
    # The empty bridge provides egress without a remote host or veth devices.
    # The later FORWARD counter stands where fw4 would add bidirectional offload.
    command("nft", "-f", "-", input="""
add table inet GuardTest
add chain inet GuardTest forward { type filter hook forward priority 0; }
add rule inet GuardTest forward counter drop
""")
    for family, client, remote, excluded in [
        (socket.AF_INET, "192.168.1.2", "1.1.1.1", False),
        (socket.AF_INET, "192.168.1.50", "1.1.1.1", True),
        (socket.AF_INET6, "2001:db8::2", "2606:4700:4700::1111", False),
        (socket.AF_INET6, "2001:db8::50", "2606:4700:4700::1111", True),
    ]:
        with socket.socket(family, socket.SOCK_DGRAM) as sock:
            if family == socket.AF_INET6:
                sock.setsockopt(socket.IPPROTO_IPV6, 75, 1)  # IPV6_TRANSPARENT
            else:
                sock.setsockopt(socket.SOL_IP, socket.IP_TRANSPARENT, 1)
            sock.bind((client, 443))
            sock.sendto(b"seed", (remote, 23456))
        before_guard = drops("replies")
        before_offload = drops("forward", "GuardTest")
        inject(family, remote, client)
        assert drops("replies") - before_guard == (0 if excluded else 1), f"incorrect filtering of a forwarded reply to {client}"
        assert drops("forward", "GuardTest") - before_offload == (1 if excluded else 0), f"a guarded reply to {client} reached the offload hook"
    print("Forwarded reply checks passed: IPv4/IPv6 replies stop before fw4 offload; excluded clients remain reachable")


def inside(directory, core):
    command("ip", "link", "set", "lo", "up")
    command("ip", "route", "add", "default", "dev", "lo")
    command("ip", "-6", "route", "add", "default", "dev", "lo")
    script = str(Path(directory) / "output.nft")
    command("nft", "-f", script)
    for family, destination in [(socket.AF_INET, "1.1.1.1"), (socket.AF_INET6, "2606:4700:4700::1111")]:
        send(family, destination, blocked=True)
        send(family, destination, mark=0x08000000)
        send(family, destination, port=53)
    if core:
        fetch_behind_guard(core, directory)
        command("nft", "-f", script)
    for family, address in [(socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")]:
        with socket.socket(family, socket.SOCK_DGRAM) as server:
            server.bind((address, 0))
            server.settimeout(1)
            send(family, address, server.getsockname()[1])
            assert server.recv(32) == b"guard-test", "router access was blocked"
    # Rebuilding/removing the main table cannot remove the separate guard.
    command("nft", "add", "table", "inet", "ForkopTable")
    command("nft", "delete", "table", "inet", "ForkopTable")
    send(socket.AF_INET, "1.1.1.1", blocked=True)
    command("nft", "-f", script)
    send(socket.AF_INET6, "2606:4700:4700::1111", blocked=True)
    rejected = subprocess.run(["nft", "-f", "-"], input=Path(script).read_text() +
                              "add rule inet ForkopGuard missing_chain counter drop\n",
                              capture_output=True, text=True)
    assert rejected.returncode != 0
    send(socket.AF_INET, "1.1.1.1", blocked=True)
    command("nft", "delete", "table", "inet", "ForkopGuard")
    send(socket.AF_INET, "1.1.1.1")

    # A delegated LAN prefix is public IPv6 but still local. The interface also
    # carries the default route here: that must not exempt the rest of the Internet.
    command("ip", "-6", "addr", "add", "2001:4860:1::1/64", "dev", "lo", "nodad")
    root = Path(__file__).resolve().parents[2]
    code = 'require("fixture").seed({settings:{source_network_interfaces:"lo* lo"}}); require("nft.guard").arm();'
    command("ucode", "-L", "tests/fakes", "-L", "tests/lib", "-L", "forkop/files/usr/lib", "-e", code, cwd=root)
    send(socket.AF_INET6, "2001:4860:1::2")
    send(socket.AF_INET6, "2606:4700:4700::1111", blocked=True)
    before = drops()
    inject(socket.AF_INET6, "2001:4860:1::2", "2001:4860:1::3")
    assert drops() == before, "traffic inside the global LAN prefix was blocked"
    inject(socket.AF_INET6, "2001:4860:1::2", "2606:4700:4700::1111")
    assert drops() > before, "a wildcard interface let external traffic bypass the guard"
    command("ip", "-6", "addr", "del", "2001:4860:1::1/64", "dev", "lo")

    # Loopback serves as an incoming interface, so the kernel needs no veth module.
    command("nft", "-f", str(Path(directory) / "ingress.nft"))
    for family, source, destination in [(socket.AF_INET, "192.168.1.2", "1.1.1.1"),
                                        (socket.AF_INET6, "2001:db8::2", "2606:4700:4700::1111")]:
        before = drops()
        inject(family, source, destination)
        assert drops() > before, "incoming traffic bypassed the guard"
    command("nft", "-f", str(Path(directory) / "excluded.nft"))
    before = drops()
    inject(socket.AF_INET, "192.168.1.50", "1.1.1.1")
    inject(socket.AF_INET6, "2001:db8::50", "2606:4700:4700::1111")
    assert drops() == before, "excluded devices were blocked"
    forwarded_replies(directory)
    print("Kernel packet checks passed: IPv4/IPv6 egress, ingress, exclusions, core mark, DNS, global IPv6 LAN, wildcard interfaces, cleanup, rearming and rollback")


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--inside", metavar="DIRECTORY")
parser.add_argument("--core", type=lambda path: str(Path(path).resolve()), help="also check a sing-box build with marked DAT fetch")
args = parser.parse_args()
if args.inside:
    inside(args.inside, args.core)
else:
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="forkop-guard-netns-") as directory:
        for name, settings, interfaces in [
            ("output", {}, []),
            ("ingress", {"routing_excluded_ips": "@system"}, ["lo"]),
            ("excluded", {"routing_excluded_ips": "@system 192.168.1.50 2001:db8::50"}, ["lo"]),
            ("replies", {"routing_excluded_ips": "@system 192.168.1.50 2001:db8::50"}, ["br-test"]),
        ]:
            code = 'print(require("nft.guard").script(' + json.dumps(settings) + ',' + json.dumps(interfaces) + ', []));'
            text = command("ucode", "-L", "tests/fakes", "-L", "tests/lib", "-L", "forkop/files/usr/lib", "-e", code, cwd=root)
            Path(directory, name + ".nft").write_text(text)
        namespace_args = ["unshare", "-Urn", sys.executable, str(Path(__file__).resolve()), "--inside", directory]
        if args.core:
            namespace_args += ["--core", args.core]
        subprocess.run(namespace_args, check=True)
