#!/usr/bin/env python3
"""Check Forkop's shared strategy fixtures against real UCI and core CLI paths.

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

    def uci_roundtrip(value, expand=False):
        source = 'let d=require("config.desync"); let value=json(' + json.dumps(json.dumps(value)) + ');'
        if expand:
            source += 'value=d.options({desync_options:sprintf("%J",value)});'
        source += 'd.validate(value); print(sprintf("%J",d.import_strategy(d.export_strategy(value))));'
        return subprocess.run(["ucode", "-L", str(ROOT / "forkop/files/usr/lib"), "-"],
                              input=source, text=True, capture_output=True, timeout=5)

    def explicit_fields(canonical, imported):
        for key, value in imported.items():
            if isinstance(value, dict):
                explicit_fields(canonical[key], value)
            else:
                # An explicit empty range clears the imported/preset range;
                # enabled UDP then receives the core's ordinary 1:1 default.
                if key == "udp_out_range" and value == "" and canonical.get("udp_mode") != "none":
                    value = "1:1"
                assert canonical.get(key) == value, (key, value, canonical)

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

    extensions = json.loads((ROOT / "tests/fixtures/desync_extensions.json").read_text())
    capabilities = subprocess.run([core, "desync", "capabilities"], text=True,
                                  capture_output=True, timeout=5)
    assert capabilities.returncode == 0, capabilities.stderr
    source = 'let f=require("singbox.features"); if (!f.desync_capabilities_supported(json(' + json.dumps(capabilities.stdout) + '))) die("Invalid r20 capabilities");'
    supported = subprocess.run(["ucode", "-L", str(ROOT / "forkop/files/usr/lib"), "-"],
                               input=source, text=True, capture_output=True, timeout=5)
    assert supported.returncode == 0, supported.stderr
    for options in extensions["accepted"]:
        checked = cli("check", json.dumps(options))
        assert checked.returncode == 0, (options, checked.stderr)
        canonical = json.loads(checked.stdout)
        imported = cli("import", json.dumps(options))
        assert imported.returncode == 0, (options, imported.stderr)
        # Import retains explicit fields while normalizing Go duration strings.
        explicit_fields(canonical, json.loads(imported.stdout))
        exported = cli("export", checked.stdout)
        assert exported.returncode == 0, exported.stderr
        again = cli("check", exported.stdout)
        assert again.returncode == 0 and json.loads(again.stdout) == canonical, (options, again.stderr)
        for value in (options, canonical):
            uci = uci_roundtrip(value)
            assert uci.returncode == 0 and json.loads(uci.stdout) == value, (value, uci.stdout, uci.stderr)
    for options in extensions["rejected"]:
        assert cli("check", json.dumps(options)).returncode != 0, options
        assert uci_roundtrip(options).returncode != 0, options
    for case in extensions["imports"]:
        checked = cli("check", json.dumps(case["input"]))
        expected = cli("check", json.dumps(case["options"]))
        assert checked.returncode == expected.returncode == 0, (case, checked.stderr, expected.stderr)
        actual_options, expected_options = json.loads(checked.stdout), json.loads(expected.stdout)
        # The core may retain an explicitly present, expanded strategy as "".
        assert actual_options.pop("strategy", "") == expected_options.pop("strategy", "") == "", case
        assert actual_options == expected_options, case
        uci = uci_roundtrip(case["input"], expand=True)
        assert uci.returncode == 0 and json.loads(uci.stdout) == case["options"], (case, uci.stdout, uci.stderr)
    for options in extensions["rejected_imports"]:
        assert cli("check", json.dumps(options)).returncode != 0, options
        assert uci_roundtrip(options, expand=True).returncode != 0, options
    print(f"PASS real core/UCI extensions conformance: {len(extensions['accepted'])} accepted strategies, "
          f"{len(extensions['rejected'])} rejected strategies, {len(extensions['imports'])} effective overrides, "
          f"{len(extensions['rejected_imports'])} rejected imports; r20 capabilities and canonical interchange checked")


if __name__ == "__main__":
    main()
