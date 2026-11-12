let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let uci = require("core.uci");
let lock = require("service.lock");
let sources = require("geodata.sources");
let constants = require("core.constants");

const MAX_SIZE = 134217728;
let paths = { binary: "/usr/bin/sing-box", job: "/tmp/forkop-geodata-job.json", worker_pid: "/var/run/forkop-geodata.pid" };

function interval(value) {
    let matched = match(common.as_string(value), /^([1-9][0-9]*)(m|h|d)$/);
    if (matched == null)
        die("Geodata update interval must use minutes, hours or days, for example 12h or 1d");
    let seconds = int(matched[1]) * ({ m: 60, h: 3600, d: 86400 })[matched[2]];
    if (seconds < 300 || seconds > 31536000)
        die("Geodata update interval must be between 5m and 365d");
    return seconds;
}

function command(args) {
    let result = exec.combined([ paths.binary, "--disable-color", "geodata", ...args ]);
    if (result.status != 0)
        die(trim(result.output) || "sing-box geodata command failed");
}

function progress(source, phase, error) {
    common.write_file_atomic(paths.job, sprintf("%J\n", {
        source, phase, error: error ?? "", updated_at: common.now_seconds(), pid: common.own_pid()
    }));
}

// The controller sends HTTP/1.0 here; body chunks are written immediately and
// never collected into a string, including when the upstream has no length.
function download(source, path) {
    let settings = uci.get_all("forkop", "settings") ?? {};
    let via = common.option(settings, "geodata_download_section", "");
    if (via == "") {
        // A stopped core must not prevent the first direct download.
        command([ "fetch", "--url", source.input, "--output", path ]);
        return;
    }
    let section = uci.get_all("forkop", via);
    if (section == null || section.action != "connection" || !common.bool_option(section, "enabled", true))
        die("Geodata download section is unavailable");
    let detour = require("singbox.constants").outbound_tag(require("config.connections").section_display_name(via));
    let file = fs.open(path, "w");
    if (!file)
        die("Cannot create geodata download candidate");
    let api = require("singbox.clash_api");
    let reply = api.exchange(api.controller(), "POST", "/geodata/download", {
        seconds: 610, body: sprintf("%J", { url: source.input, detour }),
        decode: function(reader) {
            let size = 0;
            let tail = "";
            const footer = "\nFORKOP-GEODATA-DONE\n";
            for (let chunk = reader.read(); chunk != ""; chunk = reader.read()) {
                let data = tail + chunk;
                let count = max(0, length(data) - length(footer));
                tail = substr(data, count);
                size += count;
                if (size > MAX_SIZE || (count > 0 && file.write(substr(data, 0, count)) != count))
                    die("Geodata exceeds the download limit or storage is full");
            }
            return tail == footer ? size : null;
        }
    });
    file.close();
    if (!reply || reply.status != 200 || reply.value == null || reply.value == 0)
        die("Geodata download through the section failed; the core must be running");
}

function compile(source, dat, index_path, directory, tags) {
    if (!common.ensure_dir(directory))
        die("Cannot create geodata SRS directory");
    for (let tag in tags) {
        let path = directory + "/" + tag + ".srs";
        if (fs.stat(path) != null)
            continue;
        progress(source[".name"], "compile");
        command([ "export", "--kind", source.kind, "--file", dat, "--index", index_path, "--tag", tag, "--output", path ]);
    }
}

// The live core only reads SRS, so the previous generation needs no second
// full DAT in tmpfs. Keep its SRS until a later update, then collect them too.
function prune(directory, current, previous) {
    for (let name in fs.lsdir(directory) ?? []) {
        if (match(name, /^(geosite|geoip)-[0-9a-f]{64}-v1$/) == null)
            continue;
        let path = directory + "/" + name;
        if (path == current || fs.lstat(path)?.type != "directory")
            continue;
        for (let file in fs.lsdir(path) ?? []) {
            if (file == "source.dat" || file == "index.json" ||
                (path != previous && match(file, /^[a-z0-9_.!+@-]+\.srs$/)))
                fs.unlink(path + "/" + file);
        }
        if (path != previous)
            fs.rmdir(path);
    }
}

function update(source, tags) {
    let id = source[".name"];
    let directory = sources.directory(id);
    if (!common.ensure_dir(directory))
        die("Cannot create geodata source directory");
    let candidate = directory + "/candidate.dat";
    let candidate_index = directory + "/candidate.json";
    let candidate_meta = directory + "/candidate-meta.json";
    let remote = match(source.input ?? "", /^https?:\/\//) != null;
    let dat = remote ? candidate : source.input;
    try {
        if (remote) {
            progress(id, "download");
            download(source, candidate);
        }
        let size = fs.stat(dat)?.size ?? 0;
        if (size <= 0 || size > MAX_SIZE)
            die("Geodata must be non-empty and at most 128 MiB; choose a storage directory with enough free space");
        progress(id, "validate");
        command([ "list", "--kind", source.kind, "--file", dat, "--output", candidate_index, "--summary", candidate_meta ]);
        let catalog = common.read_json_file(candidate_meta);
        fs.unlink(candidate_meta);
        if (catalog?.version != 1 || match(catalog?.sha256 ?? "", /^[0-9a-f]{64}$/) == null)
            die("sing-box returned an invalid geodata index");
        let revision = source.kind + "-" + catalog.sha256 + "-v1";
        let version = directory + "/" + revision;
        let previous = sources.active(id);
        if (previous?.revision == revision && previous?.source == source.input && previous?.kind == source.kind && fs.stat(previous.dat) != null) {
            compile(source, previous.dat, previous.index, previous.directory, tags);
            if (!common.write_file_atomic(directory + "/active.json", sprintf("%J\n", { ...previous, updated_at: common.now_seconds() })))
                die("Cannot record geodata update");
            fs.unlink(candidate);
            fs.unlink(candidate_index);
            return false;
        }
        // A fresh directory isolates failed/incomplete builds from the version in use.
        let stage = directory + "/stage";
        if (!common.ensure_dir(stage))
            die("Cannot create geodata staging directory");
        // Old interrupted staging files cannot be reused for different input.
        for (let name in fs.lsdir(stage) ?? [])
            fs.unlink(stage + "/" + name);
        compile(source, dat, candidate_index, stage, tags);
        if (!common.ensure_dir(version))
            die("Cannot create geodata version directory");
        for (let name in fs.lsdir(stage) ?? [])
            if (!fs.rename(stage + "/" + name, version + "/" + name))
                die("Cannot publish geodata SRS");
        fs.rmdir(stage);
        if (remote) {
            if (!fs.rename(candidate, version + "/source.dat"))
                die("Cannot publish geodata DAT");
            dat = version + "/source.dat";
        }
        if (!fs.rename(candidate_index, version + "/index.json"))
            die("Cannot publish geodata index");
        let next = {
            revision, directory: version, dat, index: version + "/index.json", source: source.input, kind: source.kind,
            size: catalog.size, tag_count: catalog.tag_count, updated_at: common.now_seconds(),
            signature: sources.signature(dat)
        };
        if (!common.write_file_atomic(directory + "/active.json", sprintf("%J\n", next)))
            die("Cannot publish geodata source state");
        prune(directory, version, previous?.directory);
        return previous?.revision != revision || previous?.source != source.input;
    }
    catch (e) {
        fs.unlink(candidate);
        fs.unlink(candidate_index);
        fs.unlink(candidate_meta);
        progress(id, "error", e.message);
        die(e.message);
    }
}

function locked(fn) {
    let owner = common.own_pid();
    let path = sources.root() + "/.lock";
    if (!lock.acquire(path, owner))
        die("A geodata operation is already running");
    try { let result = fn(); lock.release(path, owner); return result; }
    catch (e) { lock.release(path, owner); die(e.message); }
}

function collect_removed_sources() {
    let root = sources.root();
    for (let id in fs.lsdir(root) ?? []) {
        if (match(id, /^[A-Za-z0-9_]+$/) == null || sources.get(id) != null)
            continue;
        let directory = root + "/" + id;
        let active = common.read_json_file(directory + "/active.json");
        if (fs.lstat(directory)?.type == "directory" &&
            match(active?.revision ?? "", /^(geosite|geoip)-[0-9a-f]{64}-v1$/) != null && active.directory == directory + "/" + active.revision)
            common.remove_tree(directory);
    }
}

// Called before checking/writing the generated core configuration. Existing
// SRS survive a failed refresh; only a missing required artifact blocks Apply.
function prepare() {
    let used = sources.used();
    if (length(keys(used)) == 0) {
        if (fs.stat(sources.root()) != null)
            locked(collect_removed_sources);
        return;
    }
    locked(function() {
        collect_removed_sources();
        let errors = [];
        for (let id, tags in used) {
            let source = sources.get(id);
            if (source == null)
                die("Unknown geodata source '" + id + "'");
            let active = sources.active(id);
            // Check before attempting an export, which may leave an incomplete file.
            let reusable = active != null && active.source == source.input && active.kind == source.kind &&
                length(filter(tags, (tag) => (fs.stat(active.directory + "/" + tag + ".srs")?.size ?? 0) <= 0)) == 0;
            let failure_path = sources.directory(id) + "/failure.json";
            try {
                let refresh = active == null || active.source != source.input || active.kind != source.kind || fs.stat(active.dat) == null ||
                    (!match(source.input ?? "", /^https?:\/\//) && active.signature != sources.signature(source.input));
                if (refresh) {
                    update(source, tags);
                    fs.unlink(failure_path);
                }
                else
                    compile(source, active.dat, active.index, active.directory, tags);
            } catch (e) {
                common.write_file_atomic(failure_path, sprintf("%J\n", { attempted_at: common.now_seconds(), error: e.message }));
                if (!reusable)
                    die(e.message);
                push(errors, id + ": " + e.message);
            }
        }
        progress("", length(errors) ? "error" : "idle", join("; ", errors));
    });
}

function run(id, scheduled) {
    return locked(function() {
        fs.rmdir(sources.root() + "/.queued");
        let used = sources.used();
        let changed = false;
        let errors = [];
        for (let source in sources.all()) {
            let name = source[".name"];
            if (id != "" && id != name)
                continue;
            let failure_path = sources.directory(name) + "/failure.json";
            let failure = common.read_json_file(failure_path);
            let period = interval(source.update_interval || "1d");
            if (scheduled && (!common.bool_option(source, "auto_update", true) ||
                common.now_seconds() - (sources.active(name)?.updated_at ?? 0) < period ||
                common.now_seconds() - (failure?.attempted_at ?? 0) < min(period, 3600)))
                continue;
            try {
                changed = update(source, used[name] ?? []) || changed;
                fs.unlink(failure_path);
            } catch (e) {
                push(errors, name + ": " + e.message);
                common.write_file_atomic(failure_path, sprintf("%J\n", { attempted_at: common.now_seconds(), error: e.message }));
            }
        }
        progress("", length(errors) ? "error" : "idle", join("; ", errors));
        return changed;
    });
}

function status() {
    let rows = [];
    let used = sources.used();
    for (let source in sources.all()) {
        let state = sources.active(source[".name"]);
        let failure = common.read_json_file(sources.directory(source[".name"]) + "/failure.json");
        push(rows, { id: source[".name"], kind: source.kind, label: source.label || source[".name"],
            ready: state != null, error: failure?.error ?? "", size: state?.size ?? 0, tag_count: state?.tag_count ?? 0,
            updated_at: state?.updated_at ?? 0, used_tags: used[source[".name"]] ?? [] });
    }
    let job = common.read_json_file(paths.job);
    if (job != null && !common.pid_alive(job.pid) && job.phase != "idle" && job.phase != "error" &&
        !(job.phase == "queued" && common.now_seconds() - job.updated_at < 30))
        job = { ...job, phase: "error", error: "Geodata operation was interrupted" };
    return { sources: rows, job };
}

function tags(id, query, offset) {
    let active = sources.active(id);
    if (active == null)
        return { tags: [], total: 0, offset: 0 };
    let result = exec.capture([ paths.binary, "geodata", "tags", "--index", active.index, "--search", query ?? "", "--offset", "" + max(0, int(offset || 0)) ]);
    let page = common.parse_json(result.stdout);
    if (result.status != 0 || type(page?.tags) != "array")
        die("Cannot read geodata tag catalog");
    for (let entry in page.tags)
        entry.reference = "dat:" + id + ":" + entry.name;
    return page;
}

function start(id) {
    if (id != "" && sources.get(id) == null)
        die("Unknown geodata source");
    let queued = sources.root() + "/.queued";
    let queued_stat = fs.stat(queued);
    if (lock.held(sources.root() + "/.lock") || (queued_stat != null && common.now_seconds() - queued_stat.mtime < 30))
        die("A geodata operation is already running");
    if (queued_stat != null)
        fs.rmdir(queued);
    if (!common.ensure_dir(sources.root()) || !fs.mkdir(queued, 0700))
        die("Cannot queue geodata update");
    progress(id, "queued");
    if (!exec.background([ constants.FORKOP_BIN, "geodata_update", id ])) {
        fs.rmdir(queued);
        progress(id, "error", "Cannot start geodata update");
        die("Cannot start geodata update");
    }
    return {};
}

function worker_definition() {
    return { name: "forkop-geodata", command: [ constants.FORKOP_BIN, "geodata_worker" ], pid_file: paths.worker_pid,
        env: { FORKOP_LIB: require("core.library").dir() } };
}

function worker() {
    let worker = require("service.worker");
    let definition = worker_definition();
    worker.announce(definition);
    while (true) {
        try {
            uci.reset();
            if (run("", true))
                exec.background([ constants.FORKOP_SERVICE_INIT, "reload", "geodata_update" ]);
        } catch (e) { exec.log("warn", "Geodata: " + e.message); }
        sleep(60000);
    }
}

function start_worker() {
    let workers = require("service.worker");
    let worker = worker_definition();
    if (length(sources.all()) == 0)
        return !workers.running(worker) || workers.stop(worker);
    return workers.running(worker) || workers.start(worker);
}

return { paths, interval, prepare, run, status, tags, start, worker, start_worker,
    stop_worker: () => { let workers = require("service.worker"); let definition = worker_definition(); return !workers.running(definition) || workers.stop(definition); } };
