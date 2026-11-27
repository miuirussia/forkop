// UCI contains strategy options only. Socket ownership, routing and resolver fields are
// supplied by Forkop, never imported from a strategy.
let common = require("core.common");
let exec = require("core.exec");
let features = require("singbox.features");

const REQUIRED_VERSION = features.DESYNC_REQUIRED_VERSION;
const PRESETS = [ "auto", "custom", "split", "disorder", "tlsrec", "fake", "fake_split", "oob", "GT1", "GT2", "GT3", "GT4" ];
const MODES = [ "none", "split", "disorder", "tlsrec", "fake", "fake_split", "oob", "multi_split", "fake_disorder", "multi_disorder", "disoob", "hostfakesplit" ];
const STRINGS = [ "preset", "mode", "split_pos", "fake_sni", "fake_host", "fake_payload", "delay", "fooling", "syndata", "udp_mode", "udp_fake_payload", "udp_out_range", "strategy" ];
const BOOLS = [ "tlsrec_first", "autottl", "udp_keep_socket", "auto_tune", "quic_desync" ];
const INTS = { repeats: [ 1, 16 ], ttl: [ 1, 255 ], seqovl: [ 0, 65535 ], ipfrag: [ 0, 65535 ],
    wsize: [ 0, 65535 ], wscale: [ 0, 14 ], udp_ttl: [ 1, 255 ], udp_repeats: [ 1, 16 ], udplen: [ 0, 65507 ], quic_repeats: [ 0, 16 ] };
const ADAPTIVE = { max_attempts: [ 1, 8 ], max_concurrent: [ 1, 16 ], max_entries: [ 16, 16384 ], max_buffer: [ 512, 65536 ] };

function invalid(message) { die("Desync: " + message); }

function integer(value, limits, key) {
    if (type(value) != "int" || value < limits[0] || value > limits[1])
        invalid(key + " must be an integer from " + limits[0] + " to " + limits[1]);
}

function duration(value, key, limit) {
    let ns = type(value) == "string" ? common.duration_to_nanoseconds(value) : null;
    if (ns == null || ns > limit * 1000000000)
        invalid(key + " must be a positive duration up to " + limit + "s");
}

function validate(options, incomplete) {
    if (type(options) != "object") invalid("desync_options must be a JSON object");
    if (length(sprintf("%J", options)) > 32768) invalid("strategy exceeds 32 KiB");
    for (let key, value in options) {
        if (index(STRINGS, key) >= 0) {
            if (type(value) != "string" || (match(value, /[\r\n]/) || index(value, "\0") >= 0)) invalid(key + " must be a single-line string");
        }
        else if (index(BOOLS, key) >= 0) {
            if (type(value) != "bool") invalid(key + " must be a boolean");
        }
        else if (INTS[key] != null) integer(value, INTS[key], key);
        else if (key == "fake_sni_pool") {
            if (type(value) != "array" || length(value) > 64) invalid("fake_sni_pool must contain at most 64 names");
            for (let name in value)
                if (type(name) != "string" || name == "" || length(name) > 253 || match(name, /[^A-Za-z0-9._-]/)) invalid("invalid fake SNI pool name");
        }
        else if (key == "adaptive") {
            if (type(value) != "object") invalid("adaptive must be an object");
            for (let field, item in value) {
                if (ADAPTIVE[field] != null) integer(item, ADAPTIVE[field], "adaptive." + field);
                else if (field == "ttl") duration(item, "adaptive.ttl", 604800);
                else if (field == "timeout") duration(item, "adaptive.timeout", 60);
                else if (field == "network_id") {
                    if (type(item) != "string" || length(item) > 256 || (match(item, /[\r\n]/) || index(item, "\0") >= 0)) invalid("invalid adaptive.network_id");
                }
                else invalid("unknown adaptive option " + field);
            }
        }
        else invalid("unknown strategy option " + key);
    }
    if (options.preset != null && index(PRESETS, options.preset) < 0) invalid("unknown preset " + options.preset);
    if (options.mode != null && index(MODES, options.mode) < 0) invalid("unknown mode " + options.mode);
    if (options.udp_mode != null && index([ "none", "quic", "stun", "auto" ], options.udp_mode) < 0) invalid("unknown UDP mode " + options.udp_mode);
    if (options.delay != null && options.delay != "0" && options.delay != "0s") duration(options.delay, "delay", 1);
    if (options.fooling != null && index([ "", "none", "badseq", "badack", "badsum", "md5", "md5_badack", "badseq_badack_badsum", "datanoack", "hopbyhop", "destopt", "ipfrag", "ts", "badtimestamp" ], options.fooling) < 0)
        invalid("unknown fooling " + options.fooling);
    for (let key in [ "fake_sni", "fake_host" ])
        if (options[key] != null && (length(options[key]) > 253 || match(options[key], /[ \t]/))) invalid("invalid " + key);
    if (!incomplete && options.adaptive != null && (options.auto_tune === false || (options.auto_tune !== true && options.preset != null && options.preset != "auto")))
        invalid("adaptive requires auto_tune=true or preset=auto");
    if (!incomplete && (options.quic_desync != null || options.quic_repeats != null)) {
        let udp_mode = options.udp_mode ?? (index([ "GT1", "GT2", "GT3", "GT4" ], options.preset) >= 0 ? "auto" : "none");
        if (udp_mode != "quic" && udp_mode != "auto") invalid("QUIC options require udp_mode=quic or auto");
        if (options.quic_desync === false && options.quic_repeats > 0) invalid("quic_repeats requires quic_desync=true");
        if (options.quic_desync === false && udp_mode == "quic" && options.udplen > 0) invalid("udplen requires quic_desync=true for udp_mode=quic");
    }
    for (let key in [ "fake_payload", "udp_fake_payload", "syndata" ])
        if (options[key] != null && (b64dec(options[key]) == null || match(options[key], /[^A-Za-z0-9+\/=]/))) invalid(key + " must be base64");
    if (options.split_pos != null) {
        let positions = split(options.split_pos, ",");
        if (length(positions) > 16) invalid("at most 16 split positions are allowed");
        for (let position in positions)
            if (match(trim(position), /^([1-9][0-9]*|(sni|sniext|host|midsld|endhost|extlen)([+-][0-9]+)?)$/) == null) invalid("invalid split position " + position);
    }
    if (options.udp_out_range != null) {
        let range = match(options.udp_out_range, /^([0-9]+):([0-9]+)$/);
        if (range == null || int(range[1]) < 1 || int(range[2]) < int(range[1]) || int(range[2]) > 1024) invalid("udp_out_range must be start:end, 1..1024 inclusive");
    }
    return options;
}

// Parse the common, whitespace-delimited interchange syntax. The core performs the
// authoritative combination/platform checks and resolves presets with presence tracking.
function import_strategy(text) {
    if (type(text) != "string" || length(text) > 8192) invalid("invalid imported strategy");
    let result = {};
    text = trim(text);
    while (text != "") {
        let prefix = match(text, /^([a-z_]+)=/);
        if (prefix == null) invalid("expected key=value in strategy: " + text);
        let key = prefix[1];
        text = substr(text, length(prefix[0]));
        let end = 0, value = "", structured = false;
        if (substr(text, 0, 1) == "{" || substr(text, 0, 1) == "[") {
            let depth = 0, quoted = false;
            for (; end < length(text); end++) {
                let char = substr(text, end, 1);
                if (quoted && char == "\\") { end++; continue; }
                if (char == '"') quoted = !quoted;
                if (!quoted) {
                    if (char == "{" || char == "[") depth++;
                    if (char == "}" || char == "]") depth--;
                    if (depth == 0) { end++; break; }
                }
            }
            value = common.parse_json(substr(text, 0, end));
            if (value == null || (end < length(text) && !match(substr(text, end, 1), /[ \t\r\n]/))) invalid("invalid structured strategy value");
            structured = true;
        }
        else if (substr(text, 0, 1) == '"') {
            for (end = 1; end < length(text); end++) {
                let char = substr(text, end, 1);
                if (char == "\\") end++;
                else if (char == '"') break;
            }
            value = common.parse_json(substr(text, 0, ++end));
            if (type(value) != "string" || (end < length(text) && !match(substr(text, end, 1), /[ \t\r\n]/))) invalid("invalid quoted strategy value");
        }
        else {
            for (; end < length(text) && !match(substr(text, end, 1), /[ \t\r\n]/); end++) {}
            value = substr(text, 0, end);
        }
        text = trim(substr(text, end));
        if (key == "strategy" || result[key] != null) invalid("duplicate or recursive strategy option " + key);
        if (structured) {
            if (key != "adaptive" && key != "fake_sni_pool") invalid("structured value is not allowed for " + key);
        }
        else if (INTS[key] != null) {
            if (!match(value, /^[0-9]+$/)) invalid(key + " must be an integer");
            value = int(value);
        }
        else if (index(BOOLS, key) >= 0) {
            if (index([ "true", "false" ], value) < 0) invalid(key + " must be true or false");
            value = value == "true";
        }
        else if (key == "fake_sni_pool") value = split(value, ",");
        else if (key == "adaptive") invalid("adaptive must be a JSON object");
        result[key] = value;
    }
    return validate(result, true);
}

function export_strategy(options) {
    validate(options);
    let tokens = [];
    for (let key in sort(keys(options))) {
        if (key == "strategy") invalid("expand an imported strategy before export");
        let value = options[key];
        push(tokens, key + "=" + sprintf("%J", value));
    }
    return join(" ", tokens);
}

function options(section) {
    let raw = common.option(section, "desync_options", "{}");
    let result = common.parse_json(raw);
    validate(result, true);
    let imported = common.option(section, "desync_strategy", "");
    let embedded = result.strategy;
    delete result.strategy;
    if (embedded != null) result = { ...import_strategy(embedded), ...result };
    if (imported != "") result = { ...import_strategy(imported), ...result };
    if (result.preset == null) result.preset = "auto";
    return validate(result);
}

function support_problem(current, capabilities) {
    if (!features.desync_version_supported(current))
        return "Desync requires sing-box-forkop " + REQUIRED_VERSION + " or newer";
    if (capabilities != null && (capabilities.capability != "forkop-desync-v1" || capabilities.supported !== true))
        return type(capabilities.reason) == "string" && capabilities.reason != "" ? capabilities.reason : "This core does not advertise supported forkop-desync-v1";
    return "";
}

function check_core(options) {
    let result = exec.combined([ features.paths.binary, "desync", "check", sprintf("%J", options) ]);
    if (result.status != 0) invalid(trim(result.output) || "installed core rejected the strategy");
    let canonical = common.parse_json(result.output);
    if (type(canonical) != "object") invalid("installed core did not return canonical strategy options");
    return canonical;
}

return { REQUIRED_VERSION, PRESETS, MODES, STRINGS, BOOLS, INTS, ADAPTIVE, validate, import_strategy, export_strategy, options, support_problem, check_core };
