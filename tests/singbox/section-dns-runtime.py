#!/usr/bin/env python3
"""Run with ucode on PATH and --sing-box pointing to the Forkop core."""
import argparse
from contextlib import contextmanager
import http.server
from ipaddress import ip_address
import json
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
DNS_PORT = 15353
DOMAIN = "app.example"


def reply_dns(request, answer):
    size, = struct.unpack("!H", request.read(2))
    query = request.read(size)
    question = query[12:query.index(0, 12) + 5]
    query_type, = struct.unpack("!H", question[-4:-2])
    exists = bool(answer)
    if isinstance(answer, dict):
        labels = []
        offset = 0
        while question[offset]:
            size = question[offset]
            labels.append(question[offset + 1:offset + 1 + size].decode())
            offset += 1 + size
        name = ".".join(labels)
        exists = name in answer
        answer = answer.get(name, {}).get(query_type)
    if answer:
        address = ip_address(answer)
        if query_type != (1 if address.version == 4 else 28):
            answer = None
    response = query[:2] + struct.pack("!HHHHH", 0x8180 if exists else 0x8183, 1, int(bool(answer)), 0, 0) + question
    if answer:
        response += b"\xc0\x0c" + struct.pack("!HHIH", query_type, 1, 300, len(address.packed)) + address.packed
    return struct.pack("!H", len(response)) + response


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class SocksProxy(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(5)
        version, methods = self.rfile.read(2)
        if version == 4:
            assert methods == 1
            port, = struct.unpack("!H", self.rfile.read(2))
            host = str(ip_address(self.rfile.read(4)))
            while self.rfile.read(1) not in (b"", b"\x00"):
                pass
            if host == "0.0.0.1":
                name = bytearray()
                while (part := self.rfile.read(1)) not in (b"", b"\x00"):
                    name.extend(part)
                host = name.decode()
            self.wfile.write(b"\x00\x5a" + bytes(6))
        else:
            assert version == 5
            self.rfile.read(methods)
            self.wfile.write(b"\x05\x00")
            version, command, _, kind = self.rfile.read(4)
            assert (version, command) == (5, 1)
            host = (str(ip_address(self.rfile.read(4 if kind == 1 else 16))) if kind in (1, 4)
                    else self.rfile.read(self.rfile.read(1)[0]).decode())
            port, = struct.unpack("!H", self.rfile.read(2))
            self.wfile.write(b"\x05\x00\x00\x01" + bytes(6))
        self.server.requests.append((host, port))
        if port == DNS_PORT:
            self.wfile.write(reply_dns(self.rfile, self.server.answer))
            return
        while self.rfile.readline() not in (b"", b"\r\n"):
            pass
        body = host.encode()
        self.wfile.write(b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: "
                         + str(len(body)).encode() + b"\r\n\r\n" + body)


class TCPResolver(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(5)
        self.wfile.write(reply_dns(self.rfile, self.server.answer))


@contextmanager
def serve(handler, answer):
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as server:
        server.answer = answer
        server.requests = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield server
        finally:
            server.shutdown()
            worker.join()


@contextmanager
def mock_proxy(name, answer):
    with serve(SocksProxy, answer) as server:
        yield {"type": "socks", "tag": name, "server": "127.0.0.1", "server_port": server.server_address[1]}, server.requests


@contextmanager
def run_core(core, data, configure=None):
    source = ('require("fixture").seed(' + json.dumps(data) + '); '
              'print(sprintf("%J", require("singbox.generator").build({service_address: "127.0.0.1"})));')
    config = json.loads(subprocess.check_output(
        ["ucode", "-L", "tests/fakes", "-L", "tests/lib", "-L", "forkop/files/usr/lib", "-e", source], cwd=ROOT))
    mixed, dns, api = (free_port() for _ in range(3))
    config["inbounds"] = [
        {"type": "mixed", "tag": "system-in", "listen": "127.0.0.1", "listen_port": mixed},
        {"type": "direct", "tag": "system-dns-in", "listen": "127.0.0.1", "listen_port": dns},
    ]
    config["route"].pop("default_mark")
    config["experimental"] = {"clash_api": {"external_controller": f"127.0.0.1:{api}"}}
    if configure:
        configure(config)
    with tempfile.TemporaryDirectory(prefix="forkop-section-dns-") as directory:
        path = Path(directory) / "config.json"
        path.write_text(json.dumps(config))
        subprocess.run([core, "check", "-c", path], check=True)
        with tempfile.TemporaryFile(mode="w+") as log:
            process = subprocess.Popen([core, "run", "-c", path], stdout=log, stderr=log)
            try:
                for _ in range(100):
                    try:
                        with socket.create_connection(("127.0.0.1", api), timeout=0.1):
                            break
                    except OSError:
                        if process.poll() is not None:
                            raise RuntimeError("sing-box exited during startup")
                        time.sleep(0.03)
                else:
                    raise RuntimeError("sing-box did not start")
                yield mixed, dns, api
            except Exception:
                log.seek(0)
                print(log.read())
                raise
            finally:
                process.terminate()
                process.wait(timeout=5)


def query_dns(dns_port, name, source="127.0.0.1", query_type=1):
    qname = b"".join(bytes([len(part)]) + part.encode() for part in name.split(".")) + b"\x00"
    query = struct.pack("!HHHHHH", 123, 0x100, 1, 0, 0, 0) + qname + struct.pack("!HH", query_type, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(5)
        sock.bind((source, 0))
        sock.sendto(query, ("127.0.0.1", dns_port))
        return sock.recv(4096)


def lookup(dns_port, name, source="127.0.0.1", query_type=1):
    answer = query_dns(dns_port, name, source, query_type)
    assert struct.unpack("!H", answer[6:8])[0] == 1, answer
    return str(ip_address(answer[-4:] if query_type == 1 else answer[-16:]))


def request(mixed_port, host, port, source="127.0.0.1", credentials=None):
    url_host = f"[{host}]" if ":" in host else host
    return subprocess.run(["curl", "-fsS", "--max-time", "5", "--noproxy", "", "--interface", source,
                           "--socks5-hostname", f"127.0.0.1:{mixed_port}",
                           f"http://{url_host}:{port}/"] + (["--proxy-user", credentials] if credentials else []),
                          capture_output=True, text=True)


def connect(mixed_port, host=DOMAIN, port=443, source="127.0.0.1", credentials=None):
    response = request(mixed_port, host, port, source, credentials)
    assert response.returncode == 0, response.stderr
    return response.stdout


def select_exit(api, name):
    request = urllib.request.Request(f"http://127.0.0.1:{api}/proxies/vpn", method="PUT",
                                     data=json.dumps({"name": name}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 204


def remote_dns_uris(core):
    for scheme in ("socks5h", "socks4a"):
        with mock_proxy("exit", None) as (outbound, requests):
            data = {
                "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"]},
                "section": [{".name": "vpn", "action": "connection", "destinations": DOMAIN}],
                "connection_link": [{".name": "exit", "section": "vpn", "name": "exit",
                                     "uri": f"{scheme}://127.0.0.1:{outbound['server_port']}"}],
            }
            with run_core(core, data) as (mixed, dns, _):
                synthetic = lookup(dns, DOMAIN)
                assert synthetic.startswith("198.18."), synthetic
                assert connect(mixed) == DOMAIN, (scheme, requests)
                assert connect(mixed, synthetic) == DOMAIN, (scheme, requests)
                assert requests == [(DOMAIN, 443), (DOMAIN, 443)], (scheme, requests)


def provider_dns_uris(core, source):
    class Subscription(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(self.server.subscription.encode())

        def log_message(self, *args):
            pass

    policy_name, policy_address, exit_address = "policy.example", "93.184.216.33", "93.184.216.11"
    with tempfile.TemporaryDirectory(prefix="forkop-provider-dns-") as directory, \
            serve(Subscription, None) as subscription, serve(TCPResolver, policy_address) as policy, \
            mock_proxy("exit", exit_address) as (outbound, requests):
        path = Path(directory) / "subscription.txt"
        for scheme in ("socks5h", "socks4a", "socks4"):
            subscription.subscription = f"{scheme}://127.0.0.1:{outbound['server_port']}#exit\n"
            path.write_text(subscription.subscription)
            for caller in ("domain", "ports", "device", "server", "server-rules", "client"):
                section = {".name": "vpn", "action": "connection"}
                if caller == "domain":
                    section["destinations"] = f"{DOMAIN}\n{policy_name}"
                elif caller in ("ports", "server-rules"):
                    section["ports"] = ["443"]
                elif caller == "device":
                    section["fully_routed_ips"] = ["@system"]
                data = {
                    "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"]},
                    "section": [
                        {".name": "higher", "action": "dns", "destinations": policy_name,
                         "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
                        section,
                        {".name": "lower", "action": "dns", "destinations": DOMAIN,
                         "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
                    ],
                    "subscription_url": [{".name": "sub", "section": "vpn", "tag": "sub",
                                          "url": str(path) if source == "local" else
                                          f"http://127.0.0.1:{subscription.server_address[1]}/subscription"}],
                }
                if caller in ("server", "server-rules", "client"):
                    data["settings"]["enable_vpn_server"] = "1"
                    data["server"] = [{".name": "office", "enabled": "1", "label": "Office", "protocol": "mixed",
                                       "routing_mode": "rules" if caller == "server-rules" else
                                       "direct" if caller == "client" else "section", "routing_section": "vpn"}]
                if caller == "client":
                    data["server_client"] = [{".name": "laptop", "server": "office", "name": "Laptop",
                                              "password": "secret", "routing_override": "1",
                                              "routing_mode": "section", "routing_section": "vpn"}]

                def configure(config):
                    if caller in ("server", "server-rules", "client"):
                        config["inbounds"][0]["tag"] = "Office"
                    if caller == "client":
                        config["inbounds"][0]["users"] = [{"username": "Laptop", "password": "secret"}]

                requests.clear()
                with run_core(core, data, configure) as (mixed, dns, _):
                    credentials = "Laptop:secret" if caller == "client" else None
                    expected = exit_address if scheme == "socks4" else DOMAIN
                    result = connect(mixed, credentials=credentials)
                    assert result == expected, (source, scheme, caller, result, requests)
                    assert connect(mixed, policy_name, credentials=credentials) == (
                        policy_address if scheme == "socks4" else policy_name)
                    if caller == "domain":
                        synthetic = lookup(dns, DOMAIN)
                        assert synthetic.startswith("198.18."), synthetic
                        assert connect(mixed, synthetic) == expected
                    if scheme != "socks4":
                        assert all(port != DNS_PORT for _, port in requests), (source, scheme, caller, requests)
                    else:
                        assert ("127.0.0.1", DNS_PORT) in requests and (policy_address, 443) in requests, requests


def server_shared_dns(core, captured):
    common_address, exit_address = "93.184.216.99", "93.184.216.11"
    with serve(TCPResolver, common_address) as common, mock_proxy("exit", exit_address) as (outbound, requests), \
            mock_proxy("direct", None) as (direct, direct_requests):
        data = {
            "settings": {"enable_vpn_server": "1", "dns_strategy": "ipv4_only",
                         "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            "section": [
                {".name": "vpn", "action": "connection", "ports": ["443"],
                 "outbound_jsons": [json.dumps(outbound)]},
                {".name": "lower", "action": "dns", "destinations": DOMAIN,
                 "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            ],
            "server": [{".name": "office", "enabled": "1", "label": "Office", "protocol": "mixed",
                        "routing_mode": "rules"}],
        }
        if captured:
            data["section"].pop()

        def configure(config):
            config["inbounds"][0]["tag"] = "Office"
            config["outbounds"][0] = {**direct, "tag": "direct-out"}
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT

        with run_core(core, data, configure) as (mixed, _, _):
            if captured:
                # Send actual client DNS through the SOCKS server, on port 53 rather than 443.
                qname = b"".join(bytes([len(part)]) + part.encode() for part in DOMAIN.split(".")) + b"\x00"
                query = struct.pack("!HHHHHH", 123, 0x100, 1, 0, 0, 0) + qname + struct.pack("!HH", 1, 1)
                with socket.create_connection(("127.0.0.1", mixed), timeout=5) as sock, sock.makefile("rwb") as stream:
                    stream.write(b"\x05\x01\x00")
                    stream.flush()
                    assert stream.read(2) == b"\x05\x00"
                    stream.write(b"\x05\x01\x00\x01" + socket.inet_aton("203.0.113.53") + struct.pack("!H", 53))
                    stream.flush()
                    header = stream.read(4)
                    assert header[:2] == b"\x05\x00", header
                    stream.read(4 if header[3] == 1 else 16 if header[3] == 4 else stream.read(1)[0])
                    stream.read(2)
                    stream.write(struct.pack("!H", len(query)) + query)
                    stream.flush()
                    size, = struct.unpack("!H", stream.read(2))
                    answer = stream.read(size)
                assert str(ip_address(answer[-4:])) == common_address, (answer, requests)
                assert not requests, requests
            else:
                assert connect(mixed) == exit_address, requests
                assert ("127.0.0.1", DNS_PORT) in requests and (exit_address, 443) in requests, requests
                assert connect(mixed, port=8443) == DOMAIN
                assert direct_requests == [(DOMAIN, 8443)], direct_requests


def mixed_port_only_dns(core):
    common_address, exit_address = "93.184.216.99", "93.184.216.11"
    client, other = "127.0.0.2", "127.0.0.3"
    with serve(TCPResolver, common_address) as common, serve(TCPResolver, "127.0.0.1") as custom, \
            mock_proxy("exit", exit_address) as (outbound, requests), \
            mock_proxy("direct", None) as (direct, direct_requests):
        data = {
            "settings": {"dns_strategy": "ipv4_only",
                         "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            "section": [
                {".name": "vpn", "action": "connection", "ports": ["443"], "source_ip_cidr": [f"{client}/32"],
                 "outbound_jsons": [json.dumps({**outbound, "version": "4"})]},
                {".name": "lower", "action": "dns", "destinations": DOMAIN,
                 "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            ],
            "section_interface": [{".name": "custom", "section": "vpn", "name": "lo",
                                   "domain_resolver_enabled": "1",
                                   "domain_resolver_dns_server": [f"tcp://127.0.0.1:{custom.server_address[1]}"]}],
        }

        def configure(config):
            config["inbounds"][0]["tag"] = "tproxy-in"
            config["inbounds"][1]["tag"] = "source-dns-in"
            config["outbounds"][0] = {**direct, "tag": "direct-out"}
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT

        with run_core(core, data, configure) as (mixed, dns, api):
            select_exit(api, "vpn/exit")
            assert connect(mixed, source=client) == exit_address, requests
            assert ("127.0.0.1", DNS_PORT) in requests and (exit_address, 443) in requests, requests
            assert lookup(dns, DOMAIN, client) == common_address
            assert connect(mixed, port=8443, source=client) == DOMAIN
            assert connect(mixed, source=other) == DOMAIN
            assert direct_requests == [(DOMAIN, 8443), (DOMAIN, 443)], direct_requests


def static_lan_host(core):
    with mock_proxy("exit", "203.0.113.11") as (exit_outbound, requests):
        section = {".name": "vpn", "action": "connection", "fully_routed_ips": ["@system"],
                   "outbound_jsons": [json.dumps(exit_outbound)]}
        data = {"settings": {"static_hosts_text": "192.168.1.20 nas.home"}, "section": [section]}
        with run_core(core, data) as (_, dns, _):
            result = lookup(dns, "nas.home")
            assert result == "192.168.1.20", result
            assert requests == [], requests


def upstream_lan_host(core):
    name, client = "nas.home.arpa", "127.0.0.2"
    answers = {
        name: {1: "192.168.1.20", 28: "fd12:3456::20"},
        "public4.example": {1: "93.184.216.11"},
        "public6.example": {28: "2606:4700::1111"},
    }
    other_lan = {1: "192.168.1.21", 28: "fd12:3456::21"}
    with mock_proxy("exit", answers) as (exit_outbound, requests), \
            mock_proxy("other", {name: other_lan}) as (other_outbound, other_requests):
        data = {
            "settings": {"dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"]},
            "section": [{".name": "vpn", "action": "connection", "fully_routed_ips": ["@system", f"{client}/32"],
                         "outbound_jsons": [json.dumps(exit_outbound), json.dumps(other_outbound)]}],
        }
        for source, route_tag, dns_tag in [
            ("127.0.0.1", "system-in", "system-dns-in"),
            (client, "tproxy-in", "source-dns-in"),
        ]:
            def configure(config):
                config["inbounds"][0]["tag"] = route_tag
                config["inbounds"][1]["tag"] = dns_tag

            requests.clear()
            other_requests.clear()
            with run_core(core, data, configure) as (mixed, dns, api):
                for query_type, public_name in [
                    (1, "public4.example"), (28, "public6.example"),
                ]:
                    local = lookup(dns, name, source, query_type)
                    assert local == answers[name][query_type], (source, name, local)
                    public = lookup(dns, public_name, source, query_type)
                    assert public == answers[public_name][query_type], (source, public_name, public)
                    assert connect(mixed, public, source=source) == public
                assert ("127.0.0.1", DNS_PORT) in requests, requests
                assert all((address, 443) not in requests for address in answers[name].values()), requests
                select_exit(api, "vpn/other")
                for query_type, address in other_lan.items():
                    assert lookup(dns, name, source, query_type) == address, (source, query_type, other_requests)
                assert ("127.0.0.1", DNS_PORT) in other_requests, other_requests


def explicit_local_dns(core):
    client, other = "127.0.0.2", "127.0.0.3"
    local_name, static_name = "git.corp.lan", "nas.home"
    lan_address, static_address, exit_address = "192.168.1.22", "192.168.1.20", "93.184.216.11"
    with tempfile.TemporaryDirectory(prefix="forkop-section-rules-") as directory, \
            serve(TCPResolver, lan_address) as router, mock_proxy("exit", exit_address) as (exit_outbound, requests):
        ruleset = Path(directory) / "explicit.json"
        ruleset.write_text(json.dumps({"version": 4, "rules": [{"domain": [static_name]}]}))
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"],
                         "static_hosts_text": f"{static_address} {static_name} printer.home"},
            "section": [{".name": "vpn", "action": "connection", "destinations": f"full:{local_name}",
                         "rule_set": [str(ruleset)], "ports": ["443"], "source_ip_cidr": [f"{client}/32"],
                         "fully_routed_ips": [f"{client}/32", f"{other}/32"],
                         "outbound_jsons": [json.dumps(exit_outbound)]}],
        }

        def configure(config):
            config["inbounds"][0]["tag"] = "tproxy-in"
            config["inbounds"][1]["tag"] = "source-dns-in"
            resolver = next(server for server in config["dns"]["servers"] if server["tag"] == "dnsmasq-server")
            resolver.update(type="tcp", server_port=router.server_address[1])

        with run_core(core, data, configure) as (mixed, dns, _):
            local, static = lookup(dns, local_name, client), lookup(dns, static_name, client)
            assert local.startswith("198.18.") and static.startswith("198.18."), (local, static)
            assert connect(mixed, local, source=client) == exit_address
            assert connect(mixed, static, source=client) == static_address
            assert (exit_address, 443) in requests and (static_address, 443) in requests, requests
            assert lookup(dns, "printer.home", client) == static_address
            assert lookup(dns, "printer.lan", client) == lan_address
            assert lookup(dns, static_name, other) == static_address
            assert lookup(dns, local_name, other) == lan_address


def router_split_dns(core):
    local_address, static_address = "192.168.1.22", "192.168.1.23"
    direct_address, vpn_address = "93.184.216.11", "93.184.216.22"
    client = "127.0.0.2"
    with serve(TCPResolver, local_address) as router, serve(TCPResolver, direct_address) as common, \
            mock_proxy("exit", vpn_address) as (exit_outbound, requests):
        data = {
            "settings": {
                "unmatched_dns_mode": "router", "dns_strategy": "ipv4_only",
                "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"],
                "static_hosts_text": f"{static_address} files.office.test",
            },
            "section": [
                {".name": "direct", "action": "bypass", "destinations": "direct.example"},
                {".name": "blocked", "action": "block", "destinations": "93.184.217.0/24",
                 "source_ip_cidr": [f"{client}/32"], "ports": ["443"]},
                {".name": "vpn", "action": "connection", "destinations": f"direct.example\n{DOMAIN}",
                 "fully_routed_ips": ["@system", f"{client}/32"], "outbound_jsons": [json.dumps(exit_outbound)]},
            ],
        }

        for source, route_inbound, dns_inbound in [
            ("127.0.0.1", "system-in", "system-dns-in"),
            (client, "tproxy-in", "source-dns-in"),
        ]:
            def configure(config):
                config["inbounds"][0]["tag"] = route_inbound
                config["inbounds"][1]["tag"] = dns_inbound
                for transport in config["dns"]["servers"]:
                    if transport["tag"] == "dnsmasq-server":
                        transport.update(type="tcp", server_port=router.server_address[1])
                    elif transport.get("detour") == "vpn":
                        transport["server_port"] = DNS_PORT

            requests.clear()
            with run_core(core, data, configure) as (mixed, dns, _):
                address = lookup(dns, "nas.office.test", source)
                assert address == local_address, (dns_inbound, address, requests)
                assert lookup(dns, "files.office.test", source) == static_address
                assert lookup(dns, "direct.example", source) == direct_address
                assert not requests, requests

                synthetic = lookup(dns, DOMAIN, source)
                assert synthetic.startswith("198.18."), synthetic
                assert connect(mixed, synthetic, source=source) == vpn_address
                assert ("127.0.0.1", DNS_PORT) in requests, requests
                assert connect(mixed, direct_address, port=8443, source=source) == direct_address
                assert (direct_address, 8443) in requests, requests
                if source == client:
                    assert request(mixed, "93.184.217.11", 443, source).returncode != 0
                    assert ("93.184.217.11", 443) not in requests, requests


def selector_switch(core):
    with mock_proxy("first", "203.0.113.11") as (first, first_requests), \
            mock_proxy("second", "203.0.113.22") as (second, second_requests):
        settings = {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://9.9.9.9:{DNS_PORT}"]}
        section = {".name": "vpn", "action": "connection", "destinations": DOMAIN,
                   "outbound_jsons": [json.dumps(first), json.dumps(second)]}
        with run_core(core, {"settings": settings, "section": [section]}) as (mixed, _, api):
            assert connect(mixed) == "203.0.113.11", first_requests
            select_exit(api, "vpn/second")
            assert connect(mixed) == "203.0.113.22", second_requests
            assert second_requests == [("9.9.9.9", DNS_PORT), ("203.0.113.22", 443)], second_requests


def subnet_priority(core, action):
    # The router exempts TEST-NET destinations from capture. Use a routable prefix
    # and only dial these addresses through the fixture proxies.
    address = "93.184.216.11"
    with serve(TCPResolver, address) as dns, mock_proxy("exit", address) as (exit_outbound, exit_requests), \
            mock_proxy("direct", address) as (direct, direct_requests):
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{dns.server_address[1]}"]},
            "section": [
                {".name": "exception", "action": action, "destinations": "93.184.216.0/24",
                 "source_ip_cidr": ["@system"], "ports": ["443"]},
                {".name": "vpn", "action": "connection", "fully_routed_ips": ["@system"],
                 "outbound_jsons": [json.dumps(exit_outbound)]},
            ],
        }

        def configure(config):
            # Keep both possible application routes on loopback and give them distinct recorders.
            config["outbounds"][0] = {**direct, "tag": "direct-out"}
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT

        with run_core(core, data, configure) as (mixed, captured_dns, _):
            destination = lookup(captured_dns, DOMAIN)
            response = request(mixed, destination, 443)
            assert (address, 443) not in exit_requests, (action, destination, exit_requests)
            if action == "block":
                assert response.returncode != 0 and not direct_requests, (response, direct_requests)
            else:
                assert response.returncode == 0 and (address, 443) in direct_requests, (response, direct_requests)
            assert connect(mixed, destination, 8443) == address, exit_requests
            assert (address, 8443) in exit_requests, exit_requests


def scoped_subnet_priority(core):
    first_address, second_address = "93.184.216.11", "93.184.216.22"
    protected, other = "127.0.0.2", "127.0.0.3"
    with tempfile.TemporaryDirectory(prefix="forkop-section-rules-") as directory, \
            serve(TCPResolver, first_address) as dns, \
            mock_proxy("first", first_address) as (first, first_requests), \
            mock_proxy("second", second_address) as (second, second_requests):
        ruleset = Path(directory) / "subnets.json"
        ruleset.write_text(json.dumps({"version": 4, "rules": [{"ip_cidr": ["93.184.216.0/24"], "port": [443]}]}))
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{dns.server_address[1]}"]},
            "section": [
                {".name": "exception", "action": "block", "rule_set_with_subnets": [str(ruleset)],
                 "source_ip_cidr": [f"{protected}/32"]},
                {".name": "vpn", "action": "connection", "fully_routed_ips": [f"{protected}/32", f"{other}/32"],
                 "outbound_jsons": [json.dumps(first), json.dumps(second)]},
            ],
        }

        def configure(config):
            config["inbounds"][0]["tag"] = "tproxy-in"
            config["inbounds"][1]["tag"] = "source-dns-in"
            config["outbounds"][0] = {**second, "tag": "direct-out"}
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT

        with run_core(core, data, configure) as (mixed, captured_dns, api):
            real = lookup(captured_dns, DOMAIN, protected)
            assert real == first_address, real
            assert request(mixed, real, 443, protected).returncode != 0, first_requests
            assert connect(mixed, real, 8443, protected) == first_address

            other_real = lookup(captured_dns, DOMAIN, other)
            assert other_real == first_address, other_real
            assert connect(mixed, other_real, 443, other) == first_address
            select_exit(api, "vpn/second")
            assert connect(mixed, other_real, 443, other) == first_address, "a cached DNS answer stays an ordinary IP"
            assert lookup(captured_dns, DOMAIN, protected) == second_address, second_requests
            refreshed = lookup(captured_dns, DOMAIN, other)
            assert refreshed == second_address and connect(mixed, refreshed, 443, other) == second_address, second_requests


def tunnel_dns(core):
    name, address = "nas.tail1234.ts.net", "10.20.30.40"
    other_name, other_address = "printer.tail1234.ts.net", "10.20.30.41"
    with serve(TCPResolver, None) as dns, mock_proxy("tunnel", None) as (tunnel, tunnel_requests):
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{dns.server_address[1]}"]},
            "section": [{".name": "vpn", "action": "connection", "destinations": name}],
            "tunnel": [{".name": "work", "kind": "tailscale", "section": "vpn", "name": "Work",
                        "accept_server_dns": "1"}],
        }

        def configure(config):
            # Exercise the core's real preferred_by rule without starting a live tailnet.
            endpoint = config["endpoints"].pop()
            assert endpoint["type"] == "tailscale", endpoint
            tag = endpoint["tag"]
            config["outbounds"].append({**tunnel, "tag": tag})
            preferred = next(server for server in config["dns"]["servers"] if server["tag"] == tag)
            preferred.clear()
            preferred.update(type="hosts", tag=tag, predefined={name: [address], other_name: [other_address]})
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT
            # Tailscale dials domains using DNS Lookup with no explicit transport.
            route = next(i for i, rule in enumerate(config["route"]["rules"])
                         if rule.get("action") == "route" and rule.get("outbound") == "vpn")
            config["route"]["rules"].insert(route, {"action": "resolve", "domain": name, "inbound": "system-in"})

        with run_core(core, data, configure) as (mixed, captured_dns, _):
            synthetic = lookup(captured_dns, name)
            assert synthetic.startswith("198.18."), synthetic
            response = request(mixed, synthetic, 443)
            assert ("127.0.0.1", DNS_PORT) not in tunnel_requests, tunnel_requests
            assert response.returncode == 0 and response.stdout == address, (response, tunnel_requests)
            tunnel_requests.clear()
            answer = query_dns(captured_dns, name, query_type=16)
            assert answer[3] & 15 == 3 and ("127.0.0.1", DNS_PORT) in tunnel_requests, tunnel_requests

        data["section"][0]["fully_routed_ips"] = ["@system"]
        data["section"].insert(0, {".name": "exception", "action": "block", "destinations": "93.184.217.0/24"})
        tunnel_requests.clear()
        with run_core(core, data, configure) as (mixed, captured_dns, _):
            # A real RFC1918 answer for the explicit name would bypass OpenWrt capture.
            synthetic = lookup(captured_dns, name)
            assert synthetic.startswith("198.18."), synthetic
            assert connect(mixed, synthetic) == address
            assert tunnel_requests == [(address, 443)], tunnel_requests
            assert lookup(captured_dns, other_name) == other_address

        # A port-only section still lets the tunnel perform its preferred lookup.
        data["section"][1].pop("destinations")
        data["section"][1].pop("fully_routed_ips")
        data["section"][1]["ports"] = ["443"]
        tunnel_requests.clear()
        with run_core(core, data, configure) as (mixed, _, _):
            assert connect(mixed, name) == address
            assert tunnel_requests == [(address, 443)], tunnel_requests


def interface_dns(core):
    address = "93.184.216.11"
    with serve(TCPResolver, None) as common, serve(TCPResolver, address) as custom:
        data = {
            "settings": {"dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            "section": [
                {".name": "exception", "action": "block", "destinations": "93.184.216.0/24"},
                {".name": "vpn", "action": "connection", "fully_routed_ips": ["@system"]},
            ],
            "section_interface": [{".name": "custom", "section": "vpn", "name": "lo",
                                   "domain_resolver_enabled": "1",
                                   "domain_resolver_dns_server": [f"tcp://127.0.0.1:{custom.server_address[1]}"]}],
        }

        def configure(config):
            leaf = next(outbound for outbound in config["outbounds"] if outbound["tag"] == "vpn/lo")
            leaf.pop("routing_mark")

        with run_core(core, data, configure) as (_, captured_dns, _):
            assert lookup(captured_dns, DOMAIN) == address


def dns_section_priority(core):
    private_address, public_address = "93.184.216.22", "93.184.216.33"
    other_public_address = "93.184.216.44"
    public_name = "public.example"
    answers = {public_name: {1: public_address}}
    with serve(TCPResolver, private_address) as custom, mock_proxy("exit", answers) as (outbound, requests), \
            mock_proxy("other", {public_name: {1: other_public_address}}) as (other, other_requests):
        for source in ("json", "link"):
            data = {
                "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"]},
                "section": [
                    {".name": "private_dns", "action": "dns", "destinations": DOMAIN,
                     "dns_server": [f"tcp://127.0.0.1:{custom.server_address[1]}"]},
                    {".name": "vpn", "action": "connection", "destinations": f"{DOMAIN}\n{public_name}", "ports": ["443"]},
                    {".name": "lower_dns", "action": "dns", "destinations": public_name,
                     "dns_server": [f"tcp://127.0.0.1:{custom.server_address[1]}"]},
                ],
            }
            if source == "json":
                data["section"][1]["outbound_jsons"] = [json.dumps({**outbound, "version": "4"}), json.dumps(other)]
            else:
                data["section"][1]["outbound_jsons"] = [json.dumps(other)]
                data["connection_link"] = [{".name": "exit", "section": "vpn", "name": "exit",
                                            "uri": f"socks4://127.0.0.1:{outbound['server_port']}"}]
            requests.clear()
            other_requests.clear()
            with run_core(core, data) as (mixed, _, api):
                # The primary DNS knows no private name, so bypassing the earlier DNS section fails.
                assert connect(mixed) == private_address
                assert requests == [(private_address, 443)], (source, requests)
                # A lower DNS section must not replace the connection section's own resolver.
                assert connect(mixed, public_name) == public_address
                assert requests[-2:] == [("127.0.0.1", DNS_PORT), (public_address, 443)], (source, requests)
                select_exit(api, "vpn/other")
                assert connect(mixed) == private_address
                assert other_requests == [(private_address, 443)], (source, other_requests)
                assert connect(mixed, public_name) == other_public_address
                assert other_requests[-2:] == [("127.0.0.1", DNS_PORT), (other_public_address, 443)], (source, other_requests)


def scoped_dns_section_priority(core):
    private_address, public_address = "93.184.216.22", "93.184.216.33"
    protected, other = "127.0.0.2", "127.0.0.3"
    with tempfile.TemporaryDirectory(prefix="forkop-dns-policy-") as directory, \
            serve(TCPResolver, private_address) as custom, mock_proxy("exit", public_address) as (outbound, requests):
        ruleset = Path(directory) / "domains.json"
        ruleset.write_text(json.dumps({"version": 4, "rules": [
            {"domain": [DOMAIN], "port": [8443]}, {"ip_cidr": ["93.184.216.0/24"]},
        ]}))
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"]},
            "section": [
                {".name": "private_dns", "action": "dns", "rule_set": [str(ruleset)],
                 "source_ip_cidr": [f"{protected}/32"],
                 "dns_server": [f"tcp://127.0.0.1:{custom.server_address[1]}"]},
                {".name": "vpn", "action": "connection", "destinations": DOMAIN, "ports": ["443"],
                 "source_ip_cidr": [f"{protected}/32", f"{other}/32"], "outbound_jsons": [json.dumps(outbound)]},
            ],
        }

        def configure(config):
            config["inbounds"][0]["tag"] = "tproxy-in"
            config["inbounds"][1]["tag"] = "source-dns-in"

        with run_core(core, data, configure) as (mixed, dns, _):
            assert lookup(dns, DOMAIN, protected) == private_address
            assert connect(mixed, source=protected) == private_address
            assert requests == [(private_address, 443)], requests
            synthetic = lookup(dns, DOMAIN, other)
            assert synthetic.startswith("198.18."), synthetic
            assert connect(mixed, synthetic, source=other) == public_address
            assert ("127.0.0.1", DNS_PORT) in requests and (public_address, 443) in requests, requests


def bypass_dns_policy(core):
    address = "93.184.216.22"
    with serve(TCPResolver, address) as custom, \
            mock_proxy("exit", None) as (outbound, requests), mock_proxy("direct", None) as (direct, direct_requests):
        for ports in ([], ["443"]):
            data = {
                "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{custom.server_address[1]}"],
                             "dns_detour_enabled": "1", "dns_detour_section": "vpn"},
                "section": [
                    {".name": "bypass", "action": "bypass", "destinations": DOMAIN,
                     "source_ip_cidr": ["@system"], "ports": ports},
                    {".name": "vpn", "action": "connection", "destinations": DOMAIN,
                     "outbound_jsons": [json.dumps(outbound)]},
                ],
            }

            def configure(config):
                config["outbounds"][0] = {**direct, "tag": "direct-out"}
                for transport in config["dns"]["servers"]:
                    if transport.get("detour") == "direct-out":
                        transport.pop("detour")
                    elif transport.get("detour") == "vpn":
                        transport["server_port"] = DNS_PORT

            requests.clear()
            direct_requests.clear()
            with run_core(core, data, configure) as (mixed, dns, _):
                assert connect(mixed) == address
                assert direct_requests == [(address, 443)] and not requests, (ports, direct_requests, requests)
                if ports:
                    synthetic = lookup(dns, DOMAIN)
                    assert synthetic.startswith("198.18."), synthetic
                    assert connect(mixed, synthetic, port=8443) == address
                    assert requests == [(address, 8443)], requests


def port_only_dns(core, action):
    direct_address, exit_address, policy_address = "93.184.216.99", "93.184.216.11", "93.184.216.22"
    policy_name, lower_name = "policy.example", "lower.example"
    client, other = "127.0.0.2", "127.0.0.3"
    with serve(TCPResolver, direct_address) as common, serve(TCPResolver, policy_address) as policy, \
            mock_proxy("exit", exit_address) as (outbound, requests), \
            mock_proxy("direct", None) as (direct, direct_requests):
        section = {".name": "ports", "action": action, "ports": ["443"],
                   "source_ip_cidr": ["@system", f"{client}/32"]}
        if action == "connection":
            section["outbound_jsons"] = [json.dumps(outbound)]
        data = {
            "settings": {"dns_strategy": "ipv4_only",
                         "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            "section": [
                {".name": "higher", "action": "dns", "destinations": policy_name,
                 "source_ip_cidr": ["@system", f"{client}/32"],
                 "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
                section,
                {".name": "lower", "action": "dns", "destinations": lower_name,
                 "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
            ],
        }
        if action == "bypass":
            data["settings"].update(dns_detour_enabled="1", dns_detour_section="vpn")
            data["section"].append({".name": "vpn", "action": "connection",
                                    "outbound_jsons": [json.dumps(outbound)]})

        for source, route_tag, dns_tag in [
            ("127.0.0.1", "system-in", "system-dns-in"),
            (client, "tproxy-in", "source-dns-in"),
        ]:
            def configure(config):
                config["inbounds"][0]["tag"] = route_tag
                config["inbounds"][1]["tag"] = dns_tag
                config["outbounds"][0] = {**direct, "tag": "direct-out"}
                for transport in config["dns"]["servers"]:
                    if transport.get("detour") == "direct-out":
                        transport.pop("detour")
                    elif transport.get("detour") in ("ports", "vpn"):
                        transport["server_port"] = DNS_PORT

            requests.clear()
            direct_requests.clear()
            with run_core(core, data, configure) as (mixed, dns, _):
                # A port-only route does not change ordinary captured DNS or issue FakeIP.
                client_address = direct_address if action == "connection" else exit_address
                assert lookup(dns, DOMAIN, source) == client_address
                assert lookup(dns, policy_name, source) == policy_address
                assert lookup(dns, lower_name, source) == policy_address
                requests.clear()
                expected = exit_address if action == "connection" else direct_address
                result = connect(mixed, source=source)
                assert result == expected, (action, source, result, expected, requests, direct_requests)
                assert connect(mixed, policy_name, source=source) == policy_address
                assert connect(mixed, lower_name, source=source) == expected
                if action == "connection":
                    assert ("127.0.0.1", DNS_PORT) in requests and (expected, 443) in requests, requests
                else:
                    assert not requests and (expected, 443) in direct_requests, (requests, direct_requests)
                # The traffic route still checks the port and the selected device.
                assert connect(mixed, port=8443, source=source) == DOMAIN
                if source == client:
                    assert connect(mixed, source=other) == DOMAIN
                    assert lookup(dns, policy_name, other) == client_address


def server_section_dns(core):
    exit_address, other_address, policy_address = "93.184.216.11", "93.184.216.22", "93.184.216.33"
    policy_name = "policy.example"
    with serve(TCPResolver, "93.184.216.99") as common, serve(TCPResolver, policy_address) as policy, \
            mock_proxy("exit", exit_address) as (outbound, requests), \
            mock_proxy("other", other_address) as (other, other_requests):
        for mode in ("section", "direct", "rules"):
            data = {
                "settings": {"enable_vpn_server": "1", "dns_strategy": "ipv4_only",
                             "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"],
                             "static_hosts_text": "192.168.1.23 files.office.test"},
                "section": [
                    {".name": "higher", "action": "dns", "destinations": policy_name,
                     "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
                    {".name": "vpn", "action": "connection", "destinations": "other.example",
                     "outbound_jsons": [json.dumps(outbound), json.dumps(other)]},
                    {".name": "lower", "action": "dns", "destinations": DOMAIN,
                     "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
                ],
                "server": [{".name": "office", "enabled": "1", "label": "Office", "protocol": "mixed",
                            "routing_mode": mode, "routing_section": "vpn"}],
                "server_client": [{".name": "laptop", "server": "office", "name": "Laptop", "password": "secret",
                                   "routing_override": "0" if mode == "section" else "1",
                                   "routing_mode": "section", "routing_section": "vpn"}],
            }

            def configure(config):
                config["inbounds"][0].update(tag="Office", users=[{"username": "Laptop", "password": "secret"}])
                for transport in config["dns"]["servers"]:
                    if transport.get("detour") == "vpn":
                        transport["server_port"] = DNS_PORT

            requests.clear()
            other_requests.clear()
            with run_core(core, data, configure) as (mixed, _, api):
                assert connect(mixed, credentials="Laptop:secret") == exit_address, (mode, requests)
                assert ("127.0.0.1", DNS_PORT) in requests and (exit_address, 443) in requests, requests
                assert connect(mixed, policy_name, credentials="Laptop:secret") == policy_address
                assert (policy_address, 443) in requests, requests
                select_exit(api, "vpn/other")
                assert connect(mixed, credentials="Laptop:secret") == other_address, (mode, other_requests)
                assert ("127.0.0.1", DNS_PORT) in other_requests and (other_address, 443) in other_requests, other_requests
            if mode == "section":
                def configure_dns(config):
                    configure(config)
                    config["inbounds"][0]["tag"] = "probe"
                    config["inbounds"][1]["tag"] = "Office"

                with run_core(core, data, configure_dns) as (_, dns, _):
                    assert lookup(dns, "files.office.test") == "192.168.1.23"


def server_dns_isolation(core):
    shared_address, forced_address, policy_address = "93.184.216.11", "93.184.216.22", "93.184.216.33"
    policy_name, static_name, static_address = "policy.example", "files.office.test", "192.168.1.23"
    with serve(TCPResolver, policy_address) as policy, \
            mock_proxy("shared", shared_address) as (shared, shared_requests), \
            mock_proxy("forced", forced_address) as (forced, forced_requests), \
            mock_proxy("direct", None) as (direct, direct_requests):
        for mode in ("rules", "direct", "section"):
            clients = [
                {".name": "client_forced", "name": "Forced", "routing_override": "1", "routing_mode": "section",
                 "routing_section": "forced"},
                {".name": "client_direct", "name": "Direct", "routing_override": "1", "routing_mode": "direct"},
                {".name": "client_rules", "name": "Rules", "routing_override": "1", "routing_mode": "rules"},
                {".name": "client_inherited", "name": "Inherited", "routing_override": "0"},
            ]
            data = {
                "settings": {"enable_vpn_server": "1", "dns_strategy": "ipv4_only",
                             "dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"],
                             "static_hosts_text": f"{static_address} {static_name}"},
                "section": [
                    {".name": "higher", "action": "dns", "destinations": policy_name,
                     "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
                    {".name": "shared", "action": "connection", "destinations": f"{DOMAIN}\n{policy_name}",
                     "outbound_jsons": [json.dumps(shared)]},
                    {".name": "forced", "action": "connection", "outbound_jsons": [json.dumps(forced)]},
                ],
                "server": [{".name": "office", "enabled": "1", "label": "Office", "protocol": "mixed",
                            "routing_mode": mode, "routing_section": "forced"}],
                "server_client": [{**client, "server": "office", "password": "secret"} for client in clients],
            }

            def configure(config):
                config["inbounds"][0].update(tag="Office", users=[
                    {"username": client["name"], "password": "secret"} for client in clients
                ])
                config["outbounds"][0] = {**direct, "tag": "direct-out"}

            shared_requests.clear()
            forced_requests.clear()
            direct_requests.clear()
            with run_core(core, data, configure) as (mixed, dns, _):
                assert connect(mixed, credentials="Forced:secret") == forced_address, (mode, shared_requests, forced_requests)
                assert ("127.0.0.1", DNS_PORT) in forced_requests and (forced_address, 443) in forced_requests
                assert connect(mixed, policy_name, credentials="Forced:secret") == policy_address
                assert connect(mixed, static_name, credentials="Forced:secret") == static_address
                assert not shared_requests, (mode, shared_requests)
                assert connect(mixed, credentials="Direct:secret") == DOMAIN
                assert not shared_requests, (mode, shared_requests)
                assert connect(mixed, credentials="Inherited:secret") == (
                    shared_address if mode == "rules" else DOMAIN if mode == "direct" else forced_address)
                assert connect(mixed, credentials="Rules:secret") == shared_address
                assert ("127.0.0.1", DNS_PORT) in shared_requests and (shared_address, 443) in shared_requests
                assert lookup(dns, DOMAIN).startswith("198.18."), "captured DNS keeps the shared FakeIP policy"


def server_bypass_dns_isolation(core):
    direct_address, forced_address = "93.184.216.11", "93.184.216.22"
    with serve(TCPResolver, direct_address) as common, \
            mock_proxy("forced", forced_address) as (forced, forced_requests), \
            mock_proxy("direct", None) as (direct, direct_requests):
        data = {
            "settings": {"enable_vpn_server": "1", "dns_strategy": "ipv4_only",
                         "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            "section": [
                {".name": "bypass", "action": "bypass", "destinations": DOMAIN},
                {".name": "forced", "action": "connection", "outbound_jsons": [json.dumps(forced)]},
            ],
            "server": [{".name": "office", "enabled": "1", "label": "Office", "protocol": "mixed",
                        "routing_mode": "section", "routing_section": "forced"}],
            "server_client": [
                {".name": "inherited", "server": "office", "name": "Inherited", "password": "secret"},
                {".name": "rules", "server": "office", "name": "Rules", "password": "secret",
                 "routing_override": "1", "routing_mode": "rules"},
                {".name": "direct", "server": "office", "name": "Direct", "password": "secret",
                 "routing_override": "1", "routing_mode": "direct"},
            ],
        }

        def configure(config):
            config["inbounds"][0].update(tag="Office", users=[
                {"username": client["name"], "password": "secret"} for client in data["server_client"]
            ])
            config["outbounds"][0] = {**direct, "tag": "direct-out"}
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "forced":
                    transport["server_port"] = DNS_PORT

        with run_core(core, data, configure) as (mixed, dns, _):
            assert connect(mixed, credentials="Inherited:secret") == forced_address, forced_requests
            assert ("127.0.0.1", DNS_PORT) in forced_requests and (forced_address, 443) in forced_requests
            assert connect(mixed, credentials="Rules:secret") == direct_address, direct_requests
            assert connect(mixed, credentials="Direct:secret") == DOMAIN
            assert lookup(dns, DOMAIN) == direct_address


def unselected_tunnel_dns(core):
    exit_address, tunnel_address = "93.184.216.11", "10.20.30.40"
    with mock_proxy("exit", exit_address) as (outbound, requests), \
            mock_proxy("tunnel", tunnel_address) as (tunnel, tunnel_requests):
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{DNS_PORT}"]},
            "section": [{".name": "vpn", "action": "connection", "fully_routed_ips": ["@system"],
                         "outbound_jsons": [json.dumps(outbound)]}],
            "tunnel": [{".name": "work", "kind": "tailscale", "section": "vpn", "name": "Work",
                        "accept_server_dns": "1"}],
        }

        def configure(config):
            tag = config["endpoints"].pop()["tag"]
            config["outbounds"].append({**tunnel, "tag": tag})
            preferred = next(server for server in config["dns"]["servers"] if server["tag"] == tag)
            preferred.clear()
            preferred.update(type="hosts", tag=tag, predefined={DOMAIN: [tunnel_address]})

        with run_core(core, data, configure) as (_, dns, api):
            select_exit(api, "vpn/exit")
            assert lookup(dns, DOMAIN) == exit_address, (requests, tunnel_requests)
            assert ("127.0.0.1", DNS_PORT) in requests and not tunnel_requests


def router_retained_fakeip(core):
    client, exit_address, local_address = "127.0.0.2", "93.184.216.11", "192.168.1.22"
    static_name, static_address = "files.office.test", "192.168.1.23"
    with tempfile.TemporaryDirectory(prefix="forkop-retained-fakeip-") as directory, \
            serve(TCPResolver, None) as common, serve(TCPResolver, local_address) as router, \
            mock_proxy("exit", exit_address) as (outbound, requests):
        data = {
            "settings": {"unmatched_dns_mode": "router", "dns_strategy": "ipv4_only",
                         "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"],
                         "static_hosts_text": f"{static_address} {static_name}"},
            "section": [{".name": "vpn", "action": "connection", "destinations": DOMAIN,
                         "fully_routed_ips": [f"{client}/32"], "outbound_jsons": [json.dumps(outbound)]}],
        }

        def configure(config):
            config["inbounds"][0]["tag"] = "tproxy-in"
            config["inbounds"][1]["tag"] = "source-dns-in"
            config["experimental"]["cache_file"] = {
                "enabled": True, "path": str(Path(directory) / "cache.db"), "store_fakeip": True,
            }
            for transport in config["dns"]["servers"]:
                if transport["tag"] == "dnsmasq-server":
                    transport.update(type="tcp", server_port=router.server_address[1])
                elif transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT

        with run_core(core, data, configure) as (_, dns, _):
            synthetic = lookup(dns, DOMAIN, client)
            assert synthetic.startswith("198.18."), synthetic

        # The client still has its cached address after this rule is removed and the core reloads.
        data["section"][0].pop("destinations")
        with run_core(core, data, configure) as (mixed, dns, _):
            assert lookup(dns, DOMAIN, client) == local_address
            assert lookup(dns, "printer.lan", client) == local_address
            assert lookup(dns, static_name, client) == static_address
            assert not requests, requests
            assert connect(mixed, synthetic, source=client) == exit_address, requests
            assert ("127.0.0.1", DNS_PORT) in requests and (exit_address, 443) in requests, requests


def server_port_only_dns(core):
    exit_address, direct_address, policy_address = "93.184.216.11", "93.184.216.99", "93.184.216.22"
    policy_name = "policy.example"
    with serve(TCPResolver, direct_address) as common, serve(TCPResolver, policy_address) as policy, \
            mock_proxy("exit", exit_address) as (outbound, requests), \
            mock_proxy("forced", "93.184.216.44") as (forced, forced_requests), \
            mock_proxy("direct", None) as (direct, direct_requests):
        for mode in ("rules", "direct", "section"):
            data = {
                "settings": {"enable_vpn_server": "1", "dns_strategy": "ipv4_only",
                             "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
                "section": [
                    {".name": "higher", "action": "dns", "destinations": policy_name,
                     "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
                    {".name": "scoped", "action": "bypass", "ports": ["443"],
                     "source_ip_cidr": ["127.0.0.1/32"]},
                    {".name": "vpn", "action": "connection", "ports": ["443"],
                     "outbound_jsons": [json.dumps(outbound)]},
                    {".name": "lower", "action": "dns", "destinations": DOMAIN,
                     "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
                    {".name": "fallback", "action": "connection", "destinations": "explicit.example",
                     "outbound_jsons": [json.dumps(direct)]},
                    {".name": "forced", "action": "connection", "outbound_jsons": [json.dumps(forced)]},
                ],
                "server": [{".name": "office", "enabled": "1", "label": "Office", "protocol": "mixed",
                            "routing_mode": mode, "routing_section": "fallback"}],
                "server_client": [
                    {".name": "laptop", "server": "office", "name": "Laptop", "password": "secret",
                     "routing_override": "0" if mode == "rules" else "1", "routing_mode": "rules"},
                    {".name": "phone", "server": "office", "name": "Phone", "password": "secret",
                     "routing_override": "1", "routing_mode": "direct"},
                    {".name": "tablet", "server": "office", "name": "Tablet", "password": "secret",
                     "routing_override": "1", "routing_mode": "section", "routing_section": "forced"},
                    {".name": "follower", "server": "office", "name": "Follower", "password": "secret",
                     "routing_override": "1", "routing_mode": "rules"},
                ],
            }

            def configure(config):
                config["inbounds"][0].update(tag="Office", users=[
                    {"username": "Laptop", "password": "secret"},
                    {"username": "Phone", "password": "secret"},
                    {"username": "Tablet", "password": "secret"},
                    {"username": "Follower", "password": "secret"},
                ])
                config["outbounds"][0] = {**direct, "tag": "direct-out"}
                for transport in config["dns"]["servers"]:
                    if transport.get("detour") in ("vpn", "forced"):
                        transport["server_port"] = DNS_PORT

            requests.clear()
            forced_requests.clear()
            direct_requests.clear()
            with run_core(core, data, configure) as (mixed, dns, _):
                assert lookup(dns, DOMAIN) == direct_address
                assert lookup(dns, "explicit.example").startswith("198.18.")
                result = connect(mixed, credentials="Laptop:secret")
                assert result == exit_address, (mode, result, requests)
                assert ("127.0.0.1", DNS_PORT) in requests and (exit_address, 443) in requests, (mode, requests)
                assert connect(mixed, policy_name, credentials="Laptop:secret") == policy_address
                other_port = connect(mixed, port=8443, credentials="Laptop:secret")
                # A section server still resolves its fallback route; DNS has no application port.
                assert other_port == (exit_address if mode == "section" else DOMAIN), (mode, other_port, requests, direct_requests)
                assert connect(mixed, credentials="Phone:secret") == DOMAIN
                assert direct_requests == [(other_port, 8443), (DOMAIN, 443)], (mode, direct_requests)
                requests.clear()
                result = connect(mixed, "forced.example", credentials="Tablet:secret")
                assert result == "93.184.216.44", (mode, result, requests, forced_requests)
                assert not requests, (mode, requests)
                assert connect(mixed, policy_name, credentials="Tablet:secret") == policy_address
                assert connect(mixed, credentials="Follower:secret") == exit_address
                assert connect(mixed, policy_name, credentials="Follower:secret") == policy_address


def mixed_interface_dns(core):
    class InterfaceApplication(socketserver.StreamRequestHandler):
        def handle(self):
            self.request.settimeout(5)
            while self.rfile.readline() not in (b"", b"\r\n"):
                pass
            self.wfile.write(b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\ninterface")

    protected, other_source = "127.0.0.2", "127.0.0.3"
    first_address, second_address, policy_address = "93.184.216.11", "93.184.216.22", "93.184.216.33"
    policy_name = "policy.example"
    with serve(TCPResolver, "93.184.216.99") as common, serve(TCPResolver, policy_address) as custom, \
            serve(TCPResolver, "127.0.0.1") as interface_dns, serve(InterfaceApplication, None) as application, \
            mock_proxy("first", first_address) as (first, requests), \
            mock_proxy("second", second_address) as (second, other_requests), \
            mock_proxy("direct", None) as (direct, direct_requests):
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            "section": [
                {".name": "higher", "action": "dns", "destinations": policy_name,
                 "source_ip_cidr": [f"{protected}/32"],
                 "dns_server": [f"tcp://127.0.0.1:{custom.server_address[1]}"]},
                {".name": "vpn", "action": "connection", "destinations": f"{DOMAIN}\n{policy_name}",
                 "source_ip_cidr": [f"{protected}/32"], "ports": ["443", str(application.server_address[1])],
                 "outbound_jsons": [json.dumps({**first, "version": "4"}), json.dumps({**second, "version": "4"})]},
                {".name": "lower", "action": "dns", "destinations": DOMAIN,
                 "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            ],
            "section_interface": [{".name": "custom", "section": "vpn", "name": "lo",
                                   "domain_resolver_enabled": "1",
                                   "domain_resolver_dns_server": [f"tcp://127.0.0.1:{interface_dns.server_address[1]}"]}],
        }

        def configure(config):
            config["inbounds"][0]["tag"] = "tproxy-in"
            config["inbounds"][1]["tag"] = "source-dns-in"
            config["outbounds"][0] = {**direct, "tag": "direct-out"}
            leaf = next(outbound for outbound in config["outbounds"] if outbound["tag"] == "vpn/lo")
            assert leaf["domain_resolver"] == "vpn-interface-1-domain-resolver", leaf
            leaf.pop("routing_mark")
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT

        with run_core(core, data, configure) as (mixed, dns, api):
            assert connect(mixed, port=application.server_address[1], source=protected) == "interface"
            assert not requests and not other_requests and not direct_requests
            select_exit(api, "vpn/first")
            synthetic = lookup(dns, DOMAIN, protected)
            assert synthetic.startswith("198.18."), synthetic
            assert connect(mixed, synthetic, source=protected) == first_address, requests
            assert ("127.0.0.1", DNS_PORT) in requests and (first_address, 443) in requests, requests
            assert connect(mixed, policy_name, source=protected) == policy_address
            select_exit(api, "vpn/second")
            assert connect(mixed, synthetic, source=protected) == second_address, other_requests
            assert ("127.0.0.1", DNS_PORT) in other_requests and (second_address, 443) in other_requests, other_requests
            assert connect(mixed, port=8443, source=protected) == DOMAIN
            assert connect(mixed, source=other_source) == DOMAIN
            assert direct_requests == [(DOMAIN, 8443), (DOMAIN, 443)], direct_requests


def tunnel_dns_fallback(core, server=False):
    name, private_address, exit_address = "nas.corp.example", "10.20.30.40", "93.184.216.11"
    policy_name, policy_address = "policy.example", "93.184.216.33"
    with serve(TCPResolver, "93.184.216.99") as common, serve(TCPResolver, policy_address) as policy, \
            mock_proxy("tunnel", exit_address) as (tunnel, requests):
        data = {
            "settings": {"dns_strategy": "ipv4_only", "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            "section": [
                {".name": "higher", "action": "dns", "destinations": policy_name,
                 "dns_server": [f"tcp://127.0.0.1:{policy.server_address[1]}"]},
                {".name": "vpn", "action": "connection", "destinations": f"{name}\n{DOMAIN}\n{policy_name}"},
                {".name": "lower", "action": "dns", "destinations": DOMAIN,
                 "dns_server": [f"tcp://127.0.0.1:{common.server_address[1]}"]},
            ],
            "tunnel": [{".name": "work", "kind": "tailscale", "section": "vpn", "name": "Work",
                        "accept_server_dns": "1"}],
        }
        if server:
            data["settings"]["enable_vpn_server"] = "1"
            data["section"][1].pop("destinations")
            data["section"][1]["ports"] = ["443"]
            data["server"] = [{".name": "office", "enabled": "1", "label": "Office", "protocol": "mixed",
                               "routing_mode": "rules"}]

        def configure(config):
            inbound = "Office" if server else "system-in"
            config["inbounds"][0]["tag"] = inbound
            endpoint = config["endpoints"].pop()
            tag = endpoint["tag"]
            config["outbounds"].append({**tunnel, "tag": tag})
            preferred = next(server for server in config["dns"]["servers"] if server["tag"] == tag)
            preferred.clear()
            preferred.update(type="hosts", tag=tag, predefined={name: [private_address]})
            for transport in config["dns"]["servers"]:
                if transport.get("detour") == "vpn":
                    transport["server_port"] = DNS_PORT
            # Model the endpoint's native Lookup while keeping the test independent of a tailnet.
            route = next(i for i, rule in enumerate(config["route"]["rules"])
                         if rule.get("action") == "route" and rule.get("outbound") == "vpn")
            config["route"]["rules"].insert(route, {"action": "resolve", "domain_suffix": [name, DOMAIN, policy_name],
                                                  "inbound": inbound})

        with run_core(core, data, configure) as (mixed, dns, _):
            if server:
                assert connect(mixed, name) == private_address, requests
            else:
                synthetic = lookup(dns, name)
                assert synthetic.startswith("198.18."), synthetic
                assert connect(mixed, synthetic) == private_address
            assert requests == [(private_address, 443)], requests
            assert connect(mixed, policy_name) == policy_address
            assert connect(mixed) == exit_address, requests
            assert ("127.0.0.1", DNS_PORT) in requests, requests
            assert [item for item in requests if item[1] != DNS_PORT] == [
                (private_address, 443), (policy_address, 443), (exit_address, 443)
            ], requests


if __name__ == "__main__":
    scenarios = {"static": static_lan_host, "upstream-lan": upstream_lan_host, "explicit-local": explicit_local_dns,
                 "router-split": router_split_dns, "selector": selector_switch,
                 "subnet-block": lambda core: subnet_priority(core, "block"),
                 "subnet-bypass": lambda core: subnet_priority(core, "bypass"),
                 "subnet-source": scoped_subnet_priority, "tunnel": tunnel_dns, "interface": interface_dns,
                 "dns-priority": dns_section_priority, "dns-source": scoped_dns_section_priority,
                 "bypass-dns": bypass_dns_policy, "server-section": server_section_dns,
                 "port-only": lambda core: port_only_dns(core, "connection"),
                 "port-only-bypass": lambda core: port_only_dns(core, "bypass"),
                 "server-port-only": server_port_only_dns,
                 "mixed-interface": mixed_interface_dns, "tunnel-fallback": tunnel_dns_fallback,
                 "remote-dns": remote_dns_uris, "mixed-port-only": mixed_port_only_dns,
                 "provider-dns-local": lambda core: provider_dns_uris(core, "local"),
                 "provider-dns-http": lambda core: provider_dns_uris(core, "http"),
                 "server-tunnel": lambda core: tunnel_dns_fallback(core, True),
                 "server-captured": lambda core: server_shared_dns(core, True),
                 "server-dns-order": lambda core: server_shared_dns(core, False),
                 "server-dns-isolation": server_dns_isolation, "router-retained-fakeip": router_retained_fakeip,
                 "server-bypass-isolation": server_bypass_dns_isolation, "unselected-tunnel": unselected_tunnel_dns}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sing-box", required=True)
    parser.add_argument("scenario", nargs="*", metavar="scenario", help="scenarios to run (default: all)")
    args = parser.parse_args()
    for name in args.scenario:
        if name not in scenarios:
            parser.error(f"unknown scenario: {name}; choose from {', '.join(scenarios)}")
    for name in args.scenario or scenarios:
        scenarios[name](args.sing_box)
        print(f"{name} passed")
