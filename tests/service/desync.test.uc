let t = require("t");
let fs = require("fs");
let stub = require("stub");
let fixture = require("fixture");
let common = require("core.common");
let features = require("singbox.features");
let d = require("service.desync");
let uloop = require("uloop");
let ubus = require("ubus");
let uci = require("uci");
let core_uci = require("core.uci");
let c = require("singbox.constants");

function setup() {
    d.paths.jobs = stub.tmpdir() + "/jobs";
    fixture.seed({ settings: fixture.settings({ output_network_interface: "wan0" }),
        section: [ { ".name": "dpi", label: "DPI exit", action: "desync", desync_options: '{"preset":"split"}', desync_strategy: "mode=split" } ] });
    features.version = () => "1.14.4-r18";
    features.desync_capabilities = () => ({ capability: "forkop-desync-v1", supported: true });
    features.paths.binary = "/test/sing-box";
    uloop.__reset();
    ubus.__reset();
    stub.commands([
        [ "/test/sing-box desync check", (argv) => ({ stdout: argv[3] }) ],
        [ "/usr/bin/forkop desync_tune_worker", { status: 0 } ],
        [ "kill", { status: 0 } ]
    ]);
}
function call(method, request, session) { return d.dispatch("desync_" + method, sprintf("%J", request ?? {}), session); }
function start(extra) { return call("tune_start", { section: "dpi", target: "example.org:443", candidates: [ { preset: "split", auto_tune: false } ], ...(extra ?? {}) }); }

t.test("a bounded job checks candidates using the core, starts separately and never commits or reloads UCI", () => {
    setup();
    let before = sprintf("%J", uci.__sections("forkop"));
    let job = start({ repetitions: 2 });
    t.eq(job.success, true, job.message);
    t.eq([ job.state, job.completed, job.total ], [ "running", 0, 2 ]);
    t.eq(call("tune_progress", { id: job.id }).id, job.id);
    t.eq(uci.__commits(), []);
    t.eq(sprintf("%J", uci.__sections("forkop")), before);
    let commands = stub.command_lines();
    t.contains(commands[0], "sing-box desync check");
    t.contains(commands[1], "forkop desync_tune_worker " + job.id);
    t.eq(start().success, false, "one job at a time");
    stub.restore();
});

t.test("invalid requests cannot spawn unbounded probes or treat adaptive as a fixed candidate", () => {
    setup();
    for (let extra in [ { timeout: 0 }, { timeout: 16 }, { repetitions: 4 }, { max_duration: 121 }, { max_bytes: 1048577 },
        { concurrency: 2 }, { target: "example.org:443;reboot" }, { target: "example.org:443\n" }, { protocol: "ftp" },
        { candidates: [] }, { candidates: [ { preset: "auto" } ] }, { candidates: [ { detour: "proxy" } ] },
        { candidates: [ { strategy: "preset=auto auto_tune=true" } ] }, { unknown_limit: 1 },
        { protocol: "http", target: "https://u:p@example.org/" }, { section: "../dpi" } ]) {
        let result = start(extra);
        t.eq(result.success, false, sprintf("%J", extra));
    }
    t.eq(stub.command_lines(), []);
    t.eq(call("tune_progress", { id: "../../config/forkop" }).success, false);
    t.eq(call("apply_custom", { section: "dpi", options: {} }).success, false, "session required");
    stub.restore();
});

t.test("worker executes the same engine with bypass mark, interface and limits, records metrics and removes temporary files", () => {
    setup();
    let job = start({ repetitions: 2, protocol: "http", target: "https://example.org/test", max_bytes: 4096, timeout: 2 });
    t.ok(job.success, job.message);
    uloop.__on_run(() => {
        for (let i = 0; i < 2; i++) {
            let process = uloop.__processes()[i];
            t.eq(process.executable, "/bin/sh");
            let argv = process.args;
            t.contains(argv, "/test/sing-box");
            t.eq(argv[index(argv, "--routing-mark") + 1], "" + c.OUTBOUND_MARK);
            t.eq(argv[index(argv, "--interface") + 1], "wan0");
            t.eq(argv[index(argv, "--dns-server") + 1], "udp://77.88.8.8:53");
            t.eq(argv[index(argv, "--timeout") + 1], "2s");
            t.eq(argv[index(argv, "--max-bytes") + 1], "4096");
            fs.writefile(argv[2], sprintf("%J", { success: true, protocol: "http", latency_ms: 5 + i, bytes: 4096, throughput_bps: 1000, unrelated: "not exposed" }));
            uloop.__exit(i, 0);
        }
    });
    d.worker(job.id);
    let done = call("tune_progress", { id: job.id });
    t.eq([ done.state, done.completed, length(done.results) ], [ "completed", 2, 2 ]);
    t.eq(done.results[0].success, true);
    t.eq(done.results[1].latency_ms, 6);
    t.eq(done.results[0].unrelated, null);
    t.eq(fs.glob(d.paths.jobs + "/" + job.id + "/*"), [ d.paths.jobs + "/" + job.id + "/job.json" ]);
    t.eq(uci.__commits(), []);
    stub.restore();
});

t.test("cancellation before launch does not probe; cancellation while running terminates and waits for the child", () => {
    setup();
    let job = start();
    t.eq(call("tune_cancel", { id: job.id }).success, true);
    d.worker(job.id);
    t.eq(call("tune_progress", { id: job.id }).state, "cancelled");
    t.eq(uloop.__processes(), []);
    job = start();
    uloop.__on_run(() => {
        call("tune_cancel", { id: job.id });
        uloop.__fire("interval");
        t.eq(call("tune_progress", { id: job.id }).state, "running", "worker still owns child until exit");
        t.contains(stub.command_lines(), "kill -TERM 40000");
        uloop.__exit(0, 143);
    });
    d.worker(job.id);
    t.eq(call("tune_progress", { id: job.id }).state, "cancelled");
    t.eq(fs.glob(d.paths.jobs + "/" + job.id + "/*"), [ d.paths.jobs + "/" + job.id + "/job.json" ]);
    stub.restore();
});

t.test("a hung probe is terminated by a deadline and is recorded as a failure", () => {
    setup();
    let job = start();
    uloop.__on_run(() => {
        uloop.__fire("timer");
        t.contains(stub.command_lines(), "kill -TERM 40000");
        uloop.__exit(0, 137);
    });
    d.worker(job.id);
    let result = call("tune_progress", { id: job.id });
    t.eq([ result.state, result.results[0].success, result.results[0].error ], [ "completed", false, "Probe timed out" ]);
    stub.restore();
});

t.test("apply custom stages only the selected strategy in the caller session, clears import and never commits", () => {
    setup();
    ubus.__on("uci.get", { values: { action: "desync", desync_strategy: "mode=split" } });
    ubus.__on("uci.set", {});
    ubus.__on("uci.delete", {});
    let result = call("apply_custom", { section: "dpi", options: { preset: "split", mode: "split", auto_tune: true, adaptive: { max_attempts: 2 } } }, "session");
    t.eq(result.success, true, result.message);
    t.eq(result.options, { preset: "custom", mode: "split", auto_tune: false });
    t.eq(result.apply_required, true);
    for (let request in ubus.__calls()) {
        t.eq(request.args.ubus_rpc_session, "session");
        t.ok(request.method != "commit" && request.method != "apply");
    }
    t.eq(ubus.__calls()[2].args.option, "desync_strategy");
    t.eq(uci.__commits(), []);
    stub.restore();
});

t.test("diagnostics and cache clearing use only the active authenticated core API with encoded outbound identity", () => {
    setup();
    let api = require("singbox.clash_api");
    let original = api.request;
    let requests = [];
    api.request = (method, path, body) => {
        push(requests, { method, path, body });
        return { status: 200, body: '{"capability":"forkop-desync-v1","outbounds":{"DPI exit":{"entries":2,"current":"split","reason":"initial"}}}' };
    };
    let diagnostic = call("diagnostics", { section: "dpi" });
    t.eq(diagnostic.diagnostics.outbounds["DPI exit"].entries, 2);
    t.eq(call("clear_cache", { section: "dpi" }).cleared, true);
    t.eq(requests, [ { method: "GET", path: "/desync?outbound=DPI%20exit", body: "" }, { method: "DELETE", path: "/desync?outbound=DPI%20exit", body: "" } ]);
    api.request = original;
    t.eq(uci.__commits(), []);
    t.eq(stub.command_lines(), []);
    stub.restore();
});

t.test("stale workers fail explicitly and their temporary files are removed", () => {
    setup();
    let job = start();
    let base = d.paths.jobs + "/" + job.id;
    let data = common.read_json_file(base + "/job.json");
    data.started_at -= 20;
    data.started_monotonic_ms -= 20000;
    data.pid = 99999999;
    fs.writefile(base + "/job.json", sprintf("%J", data));
    fs.writefile(base + "/options.json", "{}");
    let status = call("tune_progress", { id: job.id });
    t.eq(status.state, "failed");
    t.contains(status.error, "exited unexpectedly");
    t.eq(fs.glob(base + "/*"), [ base + "/job.json" ]);
    stub.restore();
});

t.test("default candidates exercise the requested protocol and resident RPC handlers keep their own method", () => {
    setup();
    t.eq(map(d.probe_request({ section: "dpi", target: "example.org:443", protocol: "quic" }).candidates, (o) => o.preset), [ "GT1", "GT2", "GT3", "GT4" ]);
    t.excludes(map(d.probe_request({ section: "dpi", target: "http://example.org?test", protocol: "http" }).candidates, (o) => o.preset), "tlsrec");
    let methods = require("service.state_service").object_methods();
    let capabilities = methods.desync_capabilities.call({ args: { payload: "{}", ubus_rpc_session: "session" } });
    t.eq(capabilities.available, true);
    let progress = methods.desync_tune_progress.call({ args: { payload: '{"id":"1-2-3"}' } });
    t.contains(progress.message, "job not found");
    stub.restore();
});

t.test("probes snapshot only numeric direct Bootstrap DNS, expanding netifd upstreams without system FakeIP", () => {
    setup();
    let dns = require("singbox.dns");
    let path = dns.paths.network_resolv;
    dns.paths.network_resolv = stub.tmpdir() + "/resolv.conf.auto";
    fs.writefile(dns.paths.network_resolv, "nameserver 127.0.0.1\nnameserver 192.0.2.53\nnameserver 2001:db8::53\n");
    core_uci.set("forkop.settings.bootstrap_dns_server", [ "network", "https://1.1.1.1/dns-query" ]);
    core_uci.commit("forkop");
    let job = start();
    t.eq(job.success, true, job.message);
    t.eq(job.dns_servers, [ "udp://192.0.2.53:53", "udp://[2001:db8::53]:53", "https://1.1.1.1:443/dns-query" ]);
    dns.paths.network_resolv = path;
    stub.restore();
});

t.test("a found preset retains its measured mode and UDP settings when copied to custom", () => {
    setup();
    let resolved = { preset: "GT2", mode: "none", udp_mode: "auto", udp_repeats: 2, udp_ttl: 3, udp_out_range: "1:2", udp_keep_socket: true, quic_desync: true, auto_tune: false };
    stub.commands([
        [ "/test/sing-box desync check", { stdout: sprintf("%J", resolved) } ],
        [ "/usr/bin/forkop desync_tune_worker", { status: 0 } ]
    ]);
    let job = start({ candidates: [ { preset: "GT2", auto_tune: false } ] });
    t.eq(job.success, true, job.message);
    t.eq(common.read_json_file(d.paths.jobs + "/" + job.id + "/job.json").candidates, [ resolved ]);
    ubus.__on("uci.get", { values: { action: "desync" } });
    ubus.__on("uci.set", {});
    let applied = call("apply_custom", { section: "dpi", options: { preset: "GT2" } }, "session");
    t.eq(applied.success, true, applied.message);
    t.eq(applied.options, { ...resolved, preset: "custom" });
    stub.restore();
});

t.done();
