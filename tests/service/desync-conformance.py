#!/usr/bin/env python3
"""Check Forkop's shared fooling fixture against real UCI and core CLI paths.

Run on Linux with ucode and an independently built core:
    python3 tests/service/desync-conformance.py --core /path/to/sing-box
The browser regression consumes the same fixture. No service/config is changed.
"""
import argparse
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", required=True, type=Path)
    args = parser.parse_args()
    core = str(args.core.resolve())
    contract = json.loads((ROOT / "tests/fixtures/desync_fooling.json").read_text())

    def cli(verb, value):
        return subprocess.run([core, "desync", verb, value], text=True,
                              capture_output=True, timeout=5)

    def uci_roundtrip(value):
        source = 'let d=require("config.desync"); let value=json(' + json.dumps(json.dumps(value)) + ');'
        source += 'd.validate(value); print(sprintf("%J",d.import_strategy(d.export_strategy(value))));'
        return subprocess.run(["ucode", "-L", str(ROOT / "forkop/files/usr/lib"), "-"],
                              input=source, text=True, capture_output=True, timeout=5)

    for token in contract["accepted"]:
        options = {"preset": "custom", "mode": "fake_split", "fooling": token,
                   "auto_tune": False, "seqovl": 0}
        checked = cli("check", json.dumps(options))
        assert checked.returncode == 0, (token, checked.stderr)
        canonical = json.loads(checked.stdout)
        assert canonical["fooling"] == token and canonical["auto_tune"] is False and canonical["seqovl"] == 0
        exported = cli("export", checked.stdout)
        assert exported.returncode == 0, exported.stderr
        again = cli("check", exported.stdout)
        assert again.returncode == 0 and json.loads(again.stdout) == canonical, (token, again.stderr)
        uci = uci_roundtrip(canonical)
        assert uci.returncode == 0 and json.loads(uci.stdout) == canonical, (token, uci.stdout, uci.stderr)
    for token in contract["rejected"]:
        options = {"mode": "fake_split", "fooling": token}
        assert cli("check", json.dumps(options)).returncode != 0, token
        assert uci_roundtrip(options).returncode != 0, token
    for case in contract["exports"]:
        exported = cli("export", json.dumps(case["options"]))
        assert exported.returncode == 0, exported.stderr
        assert exported.stdout.strip() == case["strategy"], exported.stdout
        source = 'let d=require("config.desync"); print(sprintf("%J",d.import_strategy(' + json.dumps(exported.stdout.strip()) + ')));'
        uci = subprocess.run(["ucode", "-L", str(ROOT / "forkop/files/usr/lib"), "-"],
                             input=source, text=True, capture_output=True, timeout=5)
        assert uci.returncode == 0 and json.loads(uci.stdout) == case["options"], (uci.stdout, uci.stderr)
    print(f"PASS real core/UCI fooling conformance: {len(contract['accepted'])} supported tokens, "
          f"{len(contract['rejected'])} rejected values; actual browser export fixtures, canonical string/JSON and explicit false/zero preserved")


if __name__ == "__main__":
    main()
