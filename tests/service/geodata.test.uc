let t = require("t");
let fs = require("fs");
let stub = require("stub");
let fixture = require("fixture");
let common = require("core.common");
let sources = require("geodata.sources");
let service = require("geodata.service");
let generator = require("singbox.generator");
let connections = require("config.connections");
let validation = require("validation");
let constants = require("core.constants");

function argument(argv, flag) { return argv[index(argv, flag) + 1]; }

function setup(extra) {
    let root = stub.tmpdir();
    let input = root + "/external.dat";
    fs.writefile(input, "valid-dat");
    let config = {
        settings: { dns_server: "1.1.1.1", geodata_path: root + "/storage" },
        geodata: [ { ".name": "sites", kind: "geosite", input, update_interval: "1d", auto_update: "1" } ],
        section: [ { ".name": "route", enabled: "1", action: "bypass", rule_set: [ "dat:sites:youtube" ] } ],
        ...(extra ?? {})
    };
    fixture.seed(config);
    service.paths.binary = "fake-sing-box";
    service.paths.job = root + "/job.json";
    let state = { sha: "a", fail: false, invalid: false, exports: 0, fetches: 0 };
    stub.commands([ [ (argv) => argv[0] == "fake-sing-box", (argv) => {
        if (index(argv, "list") >= 0) {
            if (state.invalid)
                return { status: 1, stdout: "invalid DAT" };
            let summary = { version: 1, sha256: join("", map([ 0, 1, 2, 3, 4, 5, 6, 7 ], () => state.sha + state.sha + state.sha + state.sha + state.sha + state.sha + state.sha + state.sha)), size: 9, tag_count: 2 };
            fs.writefile(argument(argv, "--output"), "index");
            fs.writefile(argument(argv, "--summary"), sprintf("%J", summary));
            return { status: 0 };
        }
        if (index(argv, "export") >= 0) {
            state.exports++;
            if (state.fail)
                return { status: 1, stdout: "tag not found" };
            fs.writefile(argument(argv, "--output"), "SRS-" + state.sha);
            return { status: 0 };
        }
        if (index(argv, "fetch") >= 0) {
            state.fetches++;
            t.eq(argument(argv, "--routing-mark"), constants.NFT_OUTBOUND_MARK,
                "direct DAT downloads must pass the guard without a running core");
            if (state.fetch_fails)
                return { status: 1, stdout: "download failed" };
            fs.writefile(argument(argv, "--output"), "valid-dat");
            return { status: 0 };
        }
        if (index(argv, "tags") >= 0)
            return { status: 0, stdout: '{"tags":[{"name":"youtube","count":12}],"total":1,"offset":0}' };
        return { status: 1 };
    } ] ]);
    return { root, input, config, state };
}

t.test("DAT references have stable source IDs and validated tags", () => {
    t.eq(sources.parse("dat:sites:google@!cn"), { source: "sites", tag: "google@!cn" });
    for (let ref in [ "dat:sites:../escape", "dat:../sites:google", "dat:sites:google@", "https://example.com/dat" ])
        t.eq(sources.parse(ref), null);
    t.eq(service.interval("12h"), 43200);
    t.throws(() => service.interval("1m"));
    t.throws(() => service.interval("0d"));
    t.throws(() => service.interval("366d"));
});

t.test("only required tags compile, and shared references reuse the same SRS", () => {
    let run = setup();
    service.prepare();
    let active = sources.active("sites");
    t.eq(run.state.exports, 1);
    t.eq(active.tag_count, 2);
    t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-a");
    service.prepare();
    t.eq(run.state.exports, 1, "an unchanged Apply performs no extra conversion");
    let built = generator.build({ service_address: "192.168.1.1" });
    let local = filter(built.route.rule_set, (entry) => entry.path == active.directory + "/youtube.srs");
    t.eq(length(local), 1);
    t.eq([ local[0].type, local[0].format ], [ "local", "binary" ]);
    t.eq(service.tags("sites", "you", "0").tags[0].reference, "dat:sites:youtube");
    t.eq(fs.readfile(run.input), "valid-dat", "the user's source stays untouched");
    stub.restore();
});

t.test("a failed refresh preserves the active SRS and reports the source error", () => {
    let run = setup();
    service.prepare();
    let previous = sources.active("sites");
    run.state.sha = "b";
    run.state.fail = true;
    t.eq(service.run("sites", false), false);
    t.eq(sources.active("sites").revision, previous.revision);
    t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-a");
    t.eq(service.status().job.phase, "error");
    t.contains(service.status().sources[0].error, "tag not found");
    run.state.fail = false;
    t.eq(service.run("sites", false), true);
    t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-b");
    t.eq(service.status().sources[0].error, "");
    stub.restore();
});

t.test("scheduled refresh skips disabled and not-yet-due sources", () => {
    let run = setup();
    service.prepare();
    let exports = run.state.exports;
    service.run("", true);
    t.eq(run.state.exports, exports);
    run.config.geodata[0].auto_update = "0";
    fixture.seed(run.config);
    service.run("", true);
    t.eq(run.state.exports, exports);
    stub.restore();
});

t.test("Apply reuses prepared SRS after local validation or export fails", () => {
    for (let invalid in [ true, false ]) {
        let run = setup();
        service.prepare();
        let previous = sources.active("sites");
        fs.writefile(run.input, "replacement-dat");
        run.state.sha = "b";
        run.state.invalid = invalid;
        run.state.fail = !invalid;
        service.prepare();
        t.eq(sources.active("sites").revision, previous.revision);
        t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-a");
        t.contains(service.status().sources[0].error, invalid ? "invalid DAT" : "tag not found");
        t.eq(service.status().job.phase, "error");
        run.state.invalid = false;
        run.state.fail = false;
        service.prepare();
        t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-b");
        t.eq(service.status().sources[0].error, "");
        t.eq(service.status().job.phase, "idle");
        stub.restore();
    }
});

t.test("Apply reuses prepared SRS when the local DAT disappears", () => {
    let run = setup();
    service.prepare();
    fs.unlink(run.input);
    service.prepare();
    t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-a");
    t.contains(service.status().sources[0].error, "must be non-empty");
    stub.restore();
});

t.test("Apply refuses a failed refresh when a newly required tag is not prepared", () => {
    let run = setup();
    service.prepare();
    push(run.config.section[0].rule_set, "dat:sites:missing");
    fixture.seed(run.config);
    fs.writefile(run.input, "replacement-dat");
    run.state.sha = "b";
    run.state.fail = true;
    t.contains(t.throws(() => service.prepare()).message, "tag not found");
    t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-a");
    stub.restore();
});

t.test("Apply does not reuse SRS for a changed source input or kind", () => {
    for (let option in [ "input", "kind" ]) {
        let run = setup();
        service.prepare();
        run.config.geodata[0][option] = option == "kind" ? "geoip" : run.root + "/other.dat";
        fixture.seed(run.config);
        run.state.invalid = true;
        t.throws(() => service.prepare());
        stub.restore();
    }
});

t.test("removing an unused source collects its managed files but preserves local input", () => {
    let run = setup();
    service.prepare();
    let directory = sources.directory("sites");
    run.config.geodata = [];
    run.config.section = [];
    fixture.seed(run.config);
    service.prepare();
    t.eq(fs.stat(directory), null);
    t.eq(fs.readfile(run.input), "valid-dat");
    stub.restore();
});

t.test("remote updates discard old DAT generations while keeping the previous SRS", () => {
    let run = setup();
    run.config.geodata[0].input = "https://example.com/geosite.dat";
    fixture.seed(run.config);
    service.prepare();
    let previous = sources.active("sites");
    t.ok(fs.stat(previous.dat) != null);
    run.state.sha = "b";
    t.eq(service.run("sites", false), true);
    t.eq(fs.stat(previous.dat), null, "only one full managed DAT remains after publication");
    t.eq(fs.readfile(previous.directory + "/youtube.srs"), "SRS-a");
    let current = sources.active("sites");
    t.ok(fs.stat(current.dat) != null);
    let exports = run.state.exports;
    t.eq(service.run("sites", false), false);
    t.eq(run.state.exports, exports, "same digest skips conversion");
    t.eq(sources.active("sites").directory, current.directory);
    stub.restore();
});

t.test("a failed bootstrap DAT download can be retried with the guard's outbound mark", () => {
    let run = setup();
    run.config.geodata[0].input = "https://example.com/geosite.dat";
    fixture.seed(run.config);
    run.state.fetch_fails = true;
    t.contains(t.throws(() => service.prepare()).message, "download failed");
    t.eq(sources.active("sites"), null);
    run.state.fetch_fails = false;
    service.prepare();
    t.eq(run.state.fetches, 2);
    t.eq(fs.readfile(sources.resolve("dat:sites:youtube")), "SRS-a");
    stub.restore();
});

t.test("downloads through the core stream chunks and reject a missing completion marker", () => {
    let run = setup();
    run.config.geodata[0].input = "https://example.com/geosite.dat";
    run.config.settings.geodata_download_section = "proxy";
    push(run.config.section, { ".name": "proxy", action: "connection", enabled: "1" });
    fixture.seed(run.config);
    let api = require("singbox.clash_api");
    let exchange = api.exchange;
    let complete = true;
    api.exchange = function(controller, method, path, options) {
        t.eq([ method, path ], [ "POST", "/geodata/download" ]);
        t.eq(json(options.body).detour, "proxy");
        let chunks = complete ? [ "valid-", "dat\nFORKOP-", "GEODATA-DONE\n" ] : [ "truncated-dat" ];
        let position = 0;
        return { status: 200, value: options.decode({ status: 200, read: () => chunks[position++] ?? "" }) };
    };
    service.prepare();
    let previous = sources.active("sites");
    t.eq(fs.readfile(previous.dat), "valid-dat");
    complete = false;
    run.state.sha = "b";
    t.eq(service.run("sites", false), false);
    t.eq(sources.active("sites").revision, previous.revision);
    t.eq(service.status().job.phase, "error");
    api.exchange = exchange;
    stub.restore();
});

t.test("a missing remote DAT needed by rules boots its selected proxy first", () => {
    let run = setup();
    run.config.geodata[0].input = "https://example.com/geosite.dat";
    run.config.settings.geodata_download_section = "proxy";
    push(run.config.section, { ".name": "proxy", action: "connection", enabled: "1" });
    fixture.seed(run.config);
    t.ok(service.bootstrap_required(), "an empty tmpfs cannot download through a stopped core");
    delete run.config.settings.geodata_download_section;
    fixture.seed(run.config);
    t.ok(!service.bootstrap_required(), "direct downloads need no temporary core");
    service.prepare();
    run.config.settings.geodata_download_section = "proxy";
    fixture.seed(run.config);
    t.ok(!service.bootstrap_required(), "ready SRS need no temporary core");
    fs.unlink(sources.active("sites").dat);
    t.ok(!service.bootstrap_required(), "ready SRS survive a missing DAT");
    fs.unlink(sources.resolve("dat:sites:youtube"));
    t.ok(service.bootstrap_required(), "a missing DAT and SRS require proxy bootstrap again");
    stub.restore();
});

t.test("proxy DAT preparation retries while the controller's tunnel is still starting", () => {
    let run = setup();
    run.config.geodata[0].input = "https://example.com/geosite.dat";
    run.config.settings.geodata_download_section = "proxy";
    push(run.config.section, { ".name": "proxy", action: "connection", enabled: "1" });
    fixture.seed(run.config);
    let api = require("singbox.clash_api");
    let exchange = api.exchange;
    let real_sleep = global.sleep;
    let calls = 0, sleeps = [];
    global.sleep = (ms) => push(sleeps, ms);
    api.exchange = function(controller, method, path, options) {
        if (++calls < 3)
            return calls == 1 ? null : { status: 502, value: { error: "WireGuard is not ready yet" } };
        let chunks = [ "valid-dat\nFORKOP-GEODATA-DONE\n" ];
        return { status: 200, value: options.decode({ status: 200, read: () => shift(chunks) ?? "" }) };
    };
    service.prepare();
    t.eq(calls, 3);
    t.eq(sleeps, [ 2000, 2000 ]);
    t.eq(run.state.fetches, 0, "a selected proxy is never replaced by direct egress");
    t.eq(fs.readfile(sources.active("sites").dat), "valid-dat");
    api.exchange = exchange;
    global.sleep = real_sleep;
    stub.restore();
});

t.test("core downloads preserve HTTP errors and accept a complete binary stream over a real socket", () => {
    let run = setup();
    let controller = require("controller").start();
    let config_path = run.root + "/config.json";
    fs.writefile(config_path, sprintf("%J", { experimental: { clash_api: { external_controller: controller.endpoint } } }));
    run.config.settings.config_path = config_path;
    run.config.settings.geodata_download_section = "proxy";
    run.config.geodata[0].input = "https://example.com/geosite.dat";
    push(run.config.section, { ".name": "proxy", action: "connection", enabled: "1", label: "Selected VPN" });
    fixture.seed(run.config);
    connections.load();
    for (let reply in [
        { status: 400, body: "missing outbound manager\n" },
        { status: 502, body: "upstream failed\n" }
    ]) {
        controller.reply(reply);
        t.eq(service.run("sites", false), false);
        t.contains(service.status().sources[0].error, "HTTP " + reply.status + ": " + trim(reply.body));
        t.eq(fs.stat(sources.directory("sites") + "/candidate.dat"), null);
    }
    let dat = join("", map([ 0, 1, 2, 3 ], () => sprintf("%040000d", 0))) + "\u0000\xff";
    controller.reply({ status: 200, body: dat + "\nFORKOP-GEODATA-DONE\n" });
    t.eq(service.run("sites", false), true, service.status().sources[0].error);
    t.eq(fs.readfile(sources.active("sites").dat), dat);
    t.eq(service.status().sources[0].error, "");
    let request = controller.requests()[0];
    t.contains(request, '"detour": "Selected VPN"');
    stub.restore();
});

t.test("GeoIP references automatically export subnets and are refused in DNS rules", () => {
    let run = setup();
    let features = require("singbox.features");
    let binary = features.paths.binary;
    features.paths.binary = run.root + "/no-installed-core";
    run.config.geodata[0].kind = "geoip";
    fixture.seed(run.config);
    let section = run.config.section[0];
    t.eq(connections.rule_sets(section), []);
    t.eq(connections.rule_sets_with_subnets(section), [ "dat:sites:youtube" ]);
    stub.restore();
    let core = { core_tags: [ "with_clash_api" ] };
    validation.accepts(run.config, core);
    run.config.section[0].action = "dns";
    run.config.section[0].dns_server = "1.1.1.1";
    validation.refuses(run.config, "can use domain-only rule sets", core);
    run.config.section[0].action = "bypass";
    run.config.section[0].rule_set = [ "dat:missing:youtube" ];
    validation.refuses(run.config, "is neither an http(s) URL", core);
    features.paths.binary = binary;
});

t.done();
