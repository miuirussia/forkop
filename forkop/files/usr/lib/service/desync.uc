// Isolated, serial, bounded probes. A job has its own process and files; no generated
// configuration, service state, or learning database of the running core is changed.
let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let uci = require("core.uci");
let constants = require("core.constants");
let runtime_constants = require("singbox.constants");
let features = require("singbox.features");
let strategy = require("config.desync");
let connections = require("config.connections");
let lock = require("service.lock");
let runtime_dns = require("singbox.dns");

let paths = { jobs: "/var/run/forkop/desync", proc: "/proc" };
const METHODS = [ "desync_capabilities", "desync_diagnostics", "desync_tune_start", "desync_tune_progress", "desync_tune_cancel", "desync_apply_custom", "desync_clear_cache" ];
const LIMITS = { candidates: 8, repetitions: 3, timeout: 15, max_duration: 120, max_bytes: 1048576, concurrency: 1 };

function valid_id(id) { return type(id) == "string" && match(id, /^[0-9]+-[0-9]+-[0-9]+$/) != null; }
function dir(id) {
    if (!valid_id(id)) die("Invalid Desync job ID");
    return paths.jobs + "/" + id;
}
function read(id) {
    let job = common.read_json_file(dir(id) + "/job.json");
    if (job == null) die("Desync job not found");
    return job;
}
function write(job) {
    if (!common.write_file_atomic(dir(job.id) + "/job.json", sprintf("%J\n", job))) die("Cannot save Desync job");
}
function validate_section_name(name) {
    if (type(name) != "string" || !match(name, /^[A-Za-z0-9_]+$/)) die("Invalid Desync section");
}
function section(name, allow_absent) {
    validate_section_name(name);
    uci.reset();
    let value = uci.get_all("forkop", name);
    if (value == null && allow_absent) return null;
    if (value?.[".type"] != "section" || value.action != "desync") die("Select a Desync section");
    return value;
}
function support() {
    let caps = features.desync_capabilities();
    let problem = strategy.support_problem(features.version(), caps);
    if (problem != "") die(problem);
    return caps;
}
function capabilities() {
    let caps = features.desync_capabilities();
    let reason = strategy.support_problem(features.version(), caps);
    return { available: reason == "", reason, required_version: strategy.REQUIRED_VERSION,
        version: features.version(), capabilities: caps,
        limits: LIMITS };
}
function api(method, request) {
    let path = "/desync";
    if (request.section != null && request.section != "") {
        let value = section(request.section, method == "GET");
        // An unsaved form has no running outbound. Keep this response scoped:
        // omitting its outbound filter would expose unrelated sections instead.
        if (value == null) return { outbounds: {} };
        connections.load();
        let name = connections.section_display_name(value), encoded = "";
        for (let i = 0; i < length(name); i++) {
            let char = substr(name, i, 1);
            encoded += match(char, /^[A-Za-z0-9._~-]$/) ? char : sprintf("%%%02X", ord(char));
        }
        path += "?outbound=" + encoded;
    }
    let result = require("singbox.clash_api").request(method, path, "");
    if (result.status < 200 || result.status >= 300) die("Desync core API: HTTP " + result.status + ": " + substr(result.body, 0, 1024));
    return common.parse_json(result.body) ?? {};
}
function diagnostics(request) {
    support();
    return { diagnostics: api("GET", request) };
}
function clear_cache(request) {
    support();
    return { cleared: true, result: api("DELETE", request) };
}
function bounded(request, key, fallback, low, high) {
    let value = request[key] ?? fallback;
    if (type(value) != "int" || value < low || value > high) die(key + " must be an integer from " + low + " to " + high);
    return value;
}
function probe_request(request) {
    for (let key in keys(request))
        if (index([ "section", "target", "protocol", "candidates", "timeout", "repetitions", "max_duration", "max_bytes", "concurrency" ], key) < 0)
            die("Unknown Desync probe option " + key);
    // Probes use form candidates, not a saved outbound. The section is only a job label.
    validate_section_name(request.section);
    let protocol = request.protocol ?? "tls";
    if (index([ "tls", "http", "quic" ], protocol) < 0) die("Probe protocol must be tls, http or quic");
    let target = request.target;
    if (type(target) != "string" || length(target) > 2048 || (match(target, /[[:space:][:cntrl:]]/) || index(target, "\0") >= 0)) die("Invalid probe target");
    // Restrict schemes and credentials before handing a target to the core. Local test
    // endpoints remain usable; this authenticated API is also used for router diagnostics.
    if (protocol == "http") {
        if (!match(target, /^https?:\/\/[^\/?#@]+([\/?][^#]*)?$/)) die("HTTP probe target must be an HTTP(S) URL without credentials or fragment");
    }
    else if (!match(target, /^([A-Za-z0-9._-]+|\[[A-Fa-f0-9:]+\]):[0-9]+$/)) die("TLS/QUIC target must be host:port or [IPv6]:port");
    if (request.concurrency != null && (type(request.concurrency) != "int" || request.concurrency != 1)) die("Desync probes run serially (concurrency=1)");
    let timeout = bounded(request, "timeout", 5, 1, LIMITS.timeout);
    let repetitions = bounded(request, "repetitions", 1, 1, LIMITS.repetitions);
    let max_duration = bounded(request, "max_duration", 60, 1, LIMITS.max_duration);
    let max_bytes = bounded(request, "max_bytes", 65536, 1024, LIMITS.max_bytes);
    let defaults = protocol == "quic" ? [ "GT1", "GT2", "GT3", "GT4" ]
        : protocol == "http" && substr(target, 0, 7) == "http://" ? [ "split", "disorder", "fake_split" ]
        : [ "split", "tlsrec", "fake_split" ];
    let candidates = request.candidates ?? map(defaults, (preset) => ({ preset, auto_tune: false }));
    if (type(candidates) != "array" || length(candidates) < 1 || length(candidates) > LIMITS.candidates) die("Use 1..8 Desync candidates");
    candidates = map(candidates, (value) => {
        strategy.validate(value, true);
        if (value.strategy != null) {
            let fields = { ...value };
            delete fields.strategy;
            value = { ...strategy.import_strategy(value.strategy), ...fields };
        }
        if (length(sprintf("%J", value)) > 4096) die("Tuner candidate exceeds 4 KiB");
        strategy.validate(value);
        // A tuner measures the named strategy, without background learning/retries.
        if (value.auto_tune === true || value.preset == "auto" || value.adaptive != null) die("Tuner candidates must be fixed manual strategies");
        return { ...value, auto_tune: false };
    });
    return { section: request.section, target, protocol, candidates, timeout, repetitions, max_duration, max_bytes };
}
function owns_worker(job) {
    let pid = common.as_string(job.pid);
    return common.pid_alive(pid) && index(fs.readfile(paths.proc + "/" + pid + "/cmdline") ?? "", "\0desync_tune_worker\0" + job.id + "\0") >= 0;
}
function stop_orphan(job) {
    let pid = common.as_string(job.child_pid);
    let cmdline = fs.readfile(paths.proc + "/" + pid + "/cmdline") ?? "";
    if (common.pid_alive(pid) && index(cmdline, "\0desync\0probe\0") >= 0 &&
        index(cmdline, "\0" + dir(job.id) + "/options.json\0") >= 0)
        exec.ok([ "kill", "-KILL", pid ]);
}
function remove_files(id, all) {
    for (let file in fs.glob(dir(id) + "/*"))
        if (all || substr(file, -9) != "/job.json") fs.unlink(file);
    if (all) fs.rmdir(dir(id));
}
function progress(id) {
    let job = read(id);
    let owner = common.own_pid() + "", guard = paths.jobs + "/" + id + ".lock";
    let age = job.started_monotonic_ms != null ? (common.monotonic_ms() - job.started_monotonic_ms) / 1000 : common.now_seconds() - job.started_at;
    if (job.state == "running" && !owns_worker(job) && age > 10 && lock.acquire(guard, owner)) {
        try {
            // Serialize with the worker claiming this job, so a delayed launch cannot
            // resurrect a job the daemon has just failed and cleaned.
            job = read(id);
            if (job.state == "running" && !owns_worker(job)) {
                stop_orphan(job);
                job.state = fs.access(dir(id) + "/cancel") ? "cancelled" : "failed";
                job.error = "Desync worker exited unexpectedly";
                job.finished_at = common.now_seconds();
                write(job);
                remove_files(id, false);
            }
        }
        catch (e) { lock.release(guard, owner); die(e.message); }
        lock.release(guard, owner);
    }
    let result = { ...job };
    delete result.pid;
    delete result.child_pid;
    delete result.candidates;
    delete result.started_monotonic_ms;
    return result;
}
function cleanup() {
    for (let path in fs.glob(paths.jobs + "/*/job.json")) {
        let job = common.read_json_file(path);
        if (!valid_id(job?.id)) continue;
        job = progress(job.id);
        if (job.state != "running" && common.now_seconds() - (job.finished_at ?? job.started_at) > 900) remove_files(job.id, true);
    }
}
function probe_dns(settings) {
    let values = runtime_dns.bootstrap_servers(settings);
    if (length(values) < 1 || length(values) > 8) die("Desync probes require 1..8 direct Bootstrap DNS servers");
    return map(values, (value) => {
        let parsed = runtime_dns.parse_server_uri(value, true);
        if (parsed.unsupported) die(parsed.unsupported);
        let host = index(parsed.server, ":") >= 0 ? "[" + parsed.server + "]" : parsed.server;
        return parsed.type + "://" + host + ":" + parsed.server_port + parsed.path;
    });
}
function start(request) {
    let caps = support();
    let value = probe_request(request);
    uci.reset();
    let settings = uci.get_all("forkop", "settings") ?? {};
    value.dns_servers = probe_dns(settings);
    value.bind_interface = common.option(settings, "output_network_interface", "");
    if (type(caps?.protocols) == "array" && index(caps.protocols, value.protocol) < 0)
        die("Installed core does not support Desync " + value.protocol + " probes");
    value.candidates = map(value.candidates, (options) => {
        let resolved = strategy.check_core(options);
        strategy.validate(resolved);
        if (length(sprintf("%J", resolved)) > 4096) die("Resolved tuner candidate exceeds 4 KiB");
        return resolved;
    });
    common.ensure_dir(paths.jobs);
    fs.chmod(paths.jobs, 0700);
    let owner = common.own_pid() + "";
    let guard = paths.jobs + "/start.lock";
    if (!lock.acquire(guard, owner)) die("Another Desync request is starting");
    try {
        cleanup();
        for (let path in fs.glob(paths.jobs + "/*/job.json"))
            if (common.read_json_file(path)?.state == "running") die("A Desync tuner job is already running");
        let retained = sort(fs.glob(paths.jobs + "/*/job.json"), (a, b) => (fs.stat(a)?.mtime ?? 0) - (fs.stat(b)?.mtime ?? 0));
        while (length(retained) >= 16) {
            let old = common.read_json_file(shift(retained));
            if (valid_id(old?.id)) remove_files(old.id, true);
        }
        let now = clock();
        let id = sprintf("%d-%d-%d", common.own_pid(), now[0], now[1]);
        if (!fs.mkdir(dir(id), 0700)) die("Cannot create Desync job directory");
        let job = { ...value, id, state: "running", results: [], completed: 0,
            total: length(value.candidates) * value.repetitions, started_at: common.now_seconds(), started_monotonic_ms: common.monotonic_ms() };
        write(job);
        if (!exec.background([ constants.FORKOP_BIN, "desync_tune_worker", id ])) {
            remove_files(id, true);
            die("Cannot start Desync worker");
        }
        let result = progress(id);
        lock.release(guard, owner);
        return result;
    }
    catch (e) { lock.release(guard, owner); die(e.message); }
}
function cancel(id) {
    let job = read(id);
    if (job.state == "running" && !common.write_file_atomic(dir(id) + "/cancel", "cancel\n")) die("Cannot cancel Desync job");
    let result = progress(id);
    if (result.state != "running") fs.unlink(dir(id) + "/cancel");
    return result;
}

function stop_all() {
    for (let path in fs.glob(paths.jobs + "/*/job.json")) {
        let job = common.read_json_file(path);
        if (valid_id(job?.id) && job.state == "running") cancel(job.id);
    }
}

// Stage in the caller's rpcd UCI session, just like normal form saves. A separate
// Apply is still required; never commit another page's pending configuration.
function apply_custom(request, session) {
    support();
    validate_section_name(request.section);
    if (type(session) != "string" || session == "") die("Applying a strategy requires an authenticated UCI session");
    strategy.validate(request.options, true);
    let options = { ...strategy.options({ desync_options: sprintf("%J", request.options) }), auto_tune: false };
    delete options.adaptive;
    delete options.strategy;
    options = { ...strategy.check_core(options), preset: "custom", auto_tune: false };
    strategy.validate(options);
    let bus = require("ubus").connect();
    if (bus == null) die("Cannot connect to UCI");
    let args = { config: "forkop", section: request.section, ubus_rpc_session: session };
    let current = bus.call("uci", "get", args)?.values;
    if (bus.error() || current?.[".type"] != "section" || current.action != "desync") die("The session no longer contains this Desync section");
    let result = bus.call("uci", "set", { ...args, values: { desync_options: sprintf("%J", options) } });
    if (result == null || bus.error()) die("Could not stage Desync strategy");
    return { section: request.section, options, staged: true, apply_required: true };
}

function dispatch(method, payload, session) {
    try {
        if (type(payload) != "string" || length(payload) > 131072) die("Invalid Desync request");
        let request = common.parse_json(payload == "" ? "{}" : payload);
        if (type(request) != "object") die("Desync request must be a JSON object");
        let result;
        if (method == "desync_capabilities") result = capabilities();
        else if (method == "desync_diagnostics") result = diagnostics(request);
        else if (method == "desync_clear_cache") result = clear_cache(request);
        else if (method == "desync_tune_start") result = start(request);
        else if (method == "desync_tune_progress") result = progress(request.id);
        else if (method == "desync_tune_cancel") result = cancel(request.id);
        else if (method == "desync_apply_custom") result = apply_custom(request, session);
        else die("Unknown Desync API method");
        return { success: true, ...result };
    }
    catch (e) { return { success: false, message: e.message }; }
}

function worker(id) {
    let uloop = require("uloop");
    let owner = common.own_pid() + "", guard = paths.jobs + "/" + id + ".lock";
    if (!valid_id(id) || !lock.acquire(guard, owner)) return;
    let job;
    try {
        job = read(id);
        if (job.state != "running" || job.pid != null) { lock.release(guard, owner); return; }
        job.pid = common.own_pid();
        write(job);
    }
    catch (e) { lock.release(guard, owner); die(e.message); }
    lock.release(guard, owner);
    let child = null, child_pid = null, deadline_timer = null, kill_timer = null;
    let stopping = false, finished = false, timed_out = false;
    let base = dir(id);
    let deadline = common.monotonic_ms() + job.max_duration * 1000;
    let output = base + "/probe.json", error = base + "/probe.err", options_file = base + "/options.json";
    let finish = (state, reason) => {
        if (finished) return;
        finished = true;
        job.state = state;
        delete job.stop_state; delete job.stop_reason; delete job.child_pid;
        if (reason != null) job.error = reason;
        job.finished_at = common.now_seconds();
        if (fs.access(base + "/cancel")) job.state = "cancelled";
        write(job);
        remove_files(id, false);
        uloop.end();
    };
    let terminate = () => {
        if (child_pid != null) exec.ok([ "kill", "-TERM", child_pid ]);
        kill_timer = uloop.timer(500, () => {
            if (child_pid != null) exec.ok([ "kill", "-KILL", child_pid ]);
        });
    };
    let stop = (state, reason) => {
        stopping = true;
        if (child == null) finish(state, reason);
        else { job.stop_state = state; job.stop_reason = reason; terminate(); }
    };
    let next;
    next = () => {
        if (finished) return;
        if (fs.access(base + "/cancel")) { stop("cancelled"); return; }
        if (common.monotonic_ms() >= deadline) { finish("completed", "Total probe time limit reached"); return; }
        if (job.completed >= job.total) { finish("completed"); return; }
        let index = int(job.completed / job.repetitions);
        let options = job.candidates[index];
        if (!common.write_file(options_file, sprintf("%J", options))) { finish("failed", "Cannot write probe options"); return; }
        timed_out = false;
        let seconds = min(job.timeout, max(1, int((deadline - common.monotonic_ms()) / 1000)));
        let argv = [ features.paths.binary, "desync", "probe", "--options", options_file, "--target", job.target,
            "--protocol", job.protocol, "--routing-mark", "" + runtime_constants.OUTBOUND_MARK,
            "--timeout", seconds + "s", "--max-bytes", "" + job.max_bytes ];
        if (job.bind_interface != "") push(argv, "--interface", job.bind_interface);
        for (let server in job.dns_servers) push(argv, "--dns-server", server);
        child = uloop.process("/bin/sh", [ "-c", 'umask 077; exec "$@" > "$0" 2> "$FORKOP_DESYNC_ERROR"', output, ...argv ],
            { ...getenv(), FORKOP_DESYNC_ERROR: error }, (status) => {
                child = null; child_pid = null;
                delete job.child_pid;
                if (deadline_timer != null) deadline_timer.cancel(); if (kill_timer != null) kill_timer.cancel();
                if (stopping) { finish(job.stop_state, job.stop_reason); return; }
                let result = (fs.stat(output)?.size ?? 0) <= 32768 ? common.read_json_file(output) : null;
                let error_text = (fs.stat(error)?.size ?? 0) <= 4096 ? trim(fs.readfile(error) ?? "") : "Core probe error output exceeded its limit";
                let success = status == 0 && result?.success === true && !timed_out;
                let metrics = {};
                for (let key in [ "protocol", "latency_ms", "duration_ms", "bytes", "throughput_bps", "status", "tls_version" ])
                    if (result?.[key] != null) metrics[key] = result[key];
                push(job.results, { ...metrics, options, candidate: index,
                    repetition: job.completed % job.repetitions + 1, success,
                    error: timed_out ? "Probe timed out" : success ? null : substr(result?.error ?? (error_text || "Probe failed"), 0, 1024) });
                job.completed++;
                write(job);
                fs.unlink(output); fs.unlink(error); fs.unlink(options_file);
                next();
            });
        if (child == null) { finish("failed", "Cannot spawn core probe"); return; }
        child_pid = child.pid();
        job.child_pid = child_pid;
        write(job);
        deadline_timer = uloop.timer(min(seconds * 1000 + 500, max(1, deadline - common.monotonic_ms())), () => { timed_out = true; terminate(); });
    };
    uloop.init();
    let cancellation = uloop.interval(100, () => {
        if (!stopping && fs.access(base + "/cancel")) stop("cancelled");
    });
    uloop.signal("SIGTERM", () => stop("cancelled", "Worker stopped"));
    uloop.signal("SIGINT", () => stop("cancelled", "Worker interrupted"));
    try { next(); if (!finished) uloop.run(); }
    catch (e) { if (child_pid != null) exec.ok([ "kill", "-KILL", child_pid ]); finish("failed", e.message); }
    cancellation.cancel(); if (deadline_timer != null) deadline_timer.cancel(); if (kill_timer != null) kill_timer.cancel();
}

return { paths, METHODS, LIMITS, dispatch, capabilities, probe_request, progress, start, cancel, worker, cleanup, stop_all };
