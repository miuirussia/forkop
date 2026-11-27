#!/usr/bin/env python3
"""Exercise real uloop children/cancellation against an independently built core.

Run on Linux with ucode v0.0.20250529 built WITH ULOOP_SUPPORT, Python 3,
and sing-box-forkop containing the desync probe CLI:
    python3 tests/service/desync-runtime.py --core /path/to/sing-box

Only UCI is faked. The backend, uloop processes/timers, core, HTTP server,
Clash API authorization and signals are real. No installed service is changed.
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Target(http.server.BaseHTTPRequestHandler):
    hits = []
    entered = threading.Event()
    release = threading.Event()

    def do_GET(self):
        self.hits.append(self.path)
        if self.path == "/hang":
            self.entered.set()
            self.release.wait(20)
        try:
            self.send_response(200)
            self.send_header("Content-Length", "4096")
            self.end_headers()
            self.wfile.write(b"x" * 4096)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", required=True, type=Path)
    args = parser.parse_args()
    core = args.core.resolve()
    subprocess.run(["ucode", "-e", 'require("uloop");'], check=True)
    caps = json.loads(subprocess.check_output([str(core), "desync", "capabilities"]))
    assert caps["capability"] == "forkop-desync-v1" and caps["supported"]
    assert "--dns-server" in subprocess.check_output([str(core), "desync", "probe", "--help"], text=True)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Target)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    active = None
    with tempfile.TemporaryDirectory(prefix="forkop-desync-runtime-") as tmp:
        directory = Path(tmp)
        (directory / "fakes").mkdir()
        shutil.copy(ROOT / "tests/fakes/uci.uc", directory / "fakes/uci.uc")
        entry = directory / "entry.uc"
        wrapper = directory / "forkop"
        fixture_file = directory / "fixture.json"
        fixture_file.write_text(json.dumps({"settings": {"dns_server": "1.1.1.1", "bootstrap_dns_server": "1.1.1.1"},
                                           "section": [{".name": "dpi", "action": "desync", "desync_options": '{"preset":"split"}'}]}))
        entry.write_text('''let fs=require("fs");
let root=getenv("FORKOP_DESYNC_RUNTIME_DIR");
require("fixture").seed(json(fs.readfile(root+"/fixture.json")));
let features=require("singbox.features");
features.paths.binary=getenv("FORKOP_DESYNC_RUNTIME_CORE");
// Development binaries may have no release ldflag; all capabilities/checks remain real.
features.version=()=>"1.14.4-r18";
features.desync_capabilities=()=>json(require("core.exec").output([features.paths.binary,"desync","capabilities"]));
require("core.constants").FORKOP_BIN=root+"/forkop";
require("service.desync").paths.jobs=root+"/jobs";
exit(require("service.cli").main(ARGV,getenv("FORKOP_DESYNC_RUNTIME_LIB")));
''')
        wrapper.write_text("#!/bin/sh\nexec ucode " + " ".join(map(shlex.quote, [
            "-L", str(directory / "fakes"), "-L", str(ROOT / "tests/lib"),
            "-L", str(ROOT / "forkop/files/usr/lib"), str(entry)])) + ' "$@"\n')
        wrapper.chmod(0o700)
        env = {**os.environ, "FORKOP_DESYNC_RUNTIME_DIR": str(directory),
               "FORKOP_DESYNC_RUNTIME_CORE": str(core), "FORKOP_DESYNC_RUNTIME_LIB": str(ROOT / "forkop/files/usr/lib")}

        def call(method, payload=None):
            result = subprocess.run([str(wrapper), "desync_" + method, json.dumps(payload or {})],
                                    env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            assert result.stdout, result.stderr
            value = json.loads(result.stdout)
            assert value["success"], value
            return value

        def wait_job(job, state, timeout=5):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                value = call("tune_progress", {"id": job["id"]})
                if value["state"] != "running":
                    assert value["state"] == state, value
                    assert list((directory / "jobs" / job["id"]).iterdir()) == [directory / "jobs" / job["id"] / "job.json"]
                    return value
                time.sleep(0.05)
            raise AssertionError("job did not finish: " + job["id"])

        port = free_port()
        active_config = directory / "active.json"
        active_config.write_text(json.dumps({"log": {"disabled": True},
            "outbounds": [{"type": "desync", "tag": "active-dpi", "preset": "split", "auto_tune": False}],
            "experimental": {"clash_api": {"external_controller": f"127.0.0.1:{port}", "secret": "backend-test-secret"}}}))
        before = active_config.read_bytes()
        active_log = (directory / "active.log").open("w+")
        active = subprocess.Popen([str(core), "run", "-c", str(active_config)], stdout=active_log, stderr=active_log)

        def api(method="GET", auth=True):
            headers = {"Authorization": "Bearer backend-test-secret"} if auth else {}
            return urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/desync", headers=headers, method=method), timeout=2)

        try:
            deadline = time.monotonic() + 5
            while True:
                try:
                    with api() as response:
                        initial = json.load(response)
                    break
                except (urllib.error.URLError, ConnectionError):
                    if time.monotonic() >= deadline:
                        active_log.seek(0)
                        raise AssertionError(active_log.read())
                    time.sleep(0.05)
            try:
                api(auth=False)
                raise AssertionError("unauthenticated core diagnostics accepted")
            except urllib.error.HTTPError as error:
                assert error.code == 401, error.code
            assert "active-dpi" in initial["outbounds"]
            candidate = {"preset": "custom", "mode": "split", "split_pos": "1", "auto_tune": False}
            request = {"section": "dpi", "protocol": "http", "target": f"http://127.0.0.1:{server.server_port}/ok",
                       "candidates": [candidate], "timeout": 3, "max_bytes": 2048, "repetitions": 2}
            job = call("tune_start", request)
            result = wait_job(job, "completed", timeout=10)
            assert len(result["results"]) == 2 and all(item["success"] for item in result["results"]), result
            assert all(item["bytes"] == 2048 for item in result["results"]), result
            assert Target.hits.count("/ok") == 2, Target.hits

            Target.entered.clear()
            hanging = call("tune_start", {**request, "target": f"http://127.0.0.1:{server.server_port}/hang", "timeout": 15})
            assert Target.entered.wait(3), "probe did not reach the HTTP target"
            metadata = json.loads((directory / "jobs" / hanging["id"] / "job.json").read_text())
            child_pid = metadata["child_pid"]
            call("tune_cancel", {"id": hanging["id"]})
            result = wait_job(hanging, "cancelled", timeout=3)
            assert result["completed"] == 0, result
            assert not Path(f"/proc/{child_pid}").exists(), "cancelled core child survived"

            Target.entered.clear()
            timed = call("tune_start", {**request, "target": f"http://127.0.0.1:{server.server_port}/hang", "timeout": 1, "repetitions": 1})
            result = wait_job(timed, "completed", timeout=4)
            assert result["results"][0]["success"] is False, result
            assert active.poll() is None and active_config.read_bytes() == before
            with api() as response:
                assert json.load(response) == initial, "probes changed active learning/configuration"
            with api("DELETE") as response:
                assert response.status == 200
            print("PASS real worker HTTP, repeated probes, byte cap, progress, cancellation/reaping, timeout, isolated active core and authenticated diagnostics/cache clear")
        finally:
            for metadata_file in (directory / "jobs").glob("*/job.json"):
                value = json.loads(metadata_file.read_text())
                if value["state"] == "running":
                    call("tune_cancel", {"id": value["id"]})
                    wait_job(value, "cancelled", timeout=3)
            active.terminate()
            active.wait(timeout=5)
            active_log.close()
            Target.release.set()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
