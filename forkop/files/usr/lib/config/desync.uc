// UCI contains strategy options only. Socket ownership, routing and resolver fields are
// supplied by Forkop, never imported from a strategy.
let common = require("core.common");
let exec = require("core.exec");
let features = require("singbox.features");

const REQUIRED_VERSION = features.DESYNC_REQUIRED_VERSION;
const PRESETS = [ "auto", "custom", "split", "disorder", "tlsrec", "fake", "fake_split", "oob", "GT1", "GT2", "GT3", "GT4" ];
const MODES = [ "none", "split", "disorder", "tlsrec", "fake", "fake_split", "oob", "multi_split", "fake_disorder", "multi_disorder", "disoob", "hostfakesplit" ];
const STRINGS = [ "preset", "mode", "split_pos", "tlsrec_pos", "segment_order", "fake_placement", "fake_delay", "fake_tls_template", "http_mod", "hostfake_mode", "fake_sni", "fake_host", "fake_payload", "delay", "fooling", "syndata", "udp_mode", "udp_fake_payload", "udp_out_range", "quic_split_pos", "quic_order", "strategy" ];
const BOOLS = [ "tlsrec_first", "fake_tls_random", "autottl", "udp_keep_socket", "auto_tune", "quic_desync" ];
const INTS = { fake_tls_size: [ 0, 60000 ], repeats: [ 1, 16 ], ttl: [ 1, 255 ], seqovl: [ 0, 65535 ], ipfrag: [ 0, 65535 ],
    wsize: [ 0, 65535 ], wscale: [ 0, 14 ], udp_ttl: [ 1, 255 ], udp_repeats: [ 1, 16 ], udplen: [ 0, 65507 ], quic_repeats: [ 0, 16 ] };
const ADAPTIVE = { max_attempts: [ 1, 8 ], max_concurrent: [ 1, 16 ], max_entries: [ 16, 16384 ], max_buffer: [ 512, 65536 ] };

function invalid(message) { die("Desync: " + message); }

function integer(value, limits, key, incomplete) {
    if (type(value) != "int" || (!incomplete && (value < limits[0] || value > limits[1])))
        invalid(key + " must be an integer from " + limits[0] + " to " + limits[1]);
}

function duration(value, key, limit, minimum) {
    minimum ??= 0;
    let rest = type(value) == "string" ? value : "";
    let negative = substr(rest, 0, 1) == "-";
    if (match(rest, /^[+-]/)) rest = substr(rest, 1);
    let total = 0;
    const maximum = 9223372036854775807;
    const units = { ns: 1, us: 1000, "µs": 1000, "μs": 1000, ms: 1000000, s: 1000000000, m: 60000000000, h: 3600000000000, d: 86400000000000 };
    if (rest == "0") rest = "";
    else if (rest == "") invalid(key + " must include a duration unit");
    while (rest != "") {
        let part = match(rest, /^([0-9]+(\.[0-9]*)?|\.[0-9]+)(ns|us|µs|μs|ms|s|m|h|d)/);
        if (part == null) invalid(key + " must include a supported duration unit");
        let scale = units[part[3]], amounts = split(part[1], ".");
        let whole = (amounts[0] || "0") * 1.0;
        if (whole > maximum / scale) invalid(key + " exceeds the core duration range");
        // Go truncates each component below one nanosecond before summing.
        let fraction = amounts[1] ?? "", ns = 0;
        for (let i = length(fraction) - 1; i >= 0; i--)
            ns = int((ns + int(substr(fraction, i, 1)) * scale) / 10);
        let component = int(whole * scale);
        if (component < 0 || component > maximum - ns || total > maximum - component - ns)
            invalid(key + " exceeds the core duration range");
        total += component + ns;
        rest = substr(rest, length(part[0]));
    }
    if (negative) total = -total;
    if (limit != null && total > limit * 1000000000) invalid(key + " exceeds " + limit + "s");
    if (limit != null && total < minimum * 1000000000) invalid(key + " must be at least " + minimum + "s");
    return total;
}

function validate_extensions(options) {
    let mode = options.mode ?? (index([ "GT1", "GT2", "GT3", "GT4" ], options.preset) >= 0 ? "none" :
        index(MODES, options.preset) >= 0 ? options.preset : "split");
    let fake = index([ "fake", "fake_split", "fake_disorder", "hostfakesplit", "oob", "disoob" ], mode) >= 0;
    if (options.split_pos === "" && mode != "none" &&
        !(index([ "fake", "oob" ], mode) >= 0 && options.tlsrec_first !== true))
        invalid("invalid split position " + options.split_pos);
    if (options.tlsrec_pos && mode != "tlsrec" && options.tlsrec_first !== true)
        invalid("tlsrec_pos requires mode=tlsrec or tlsrec_first=true");
    let record_pos = options.tlsrec_pos || ((mode == "tlsrec" || options.tlsrec_first === true) ? options.split_pos : "");
    for (let position in split(record_pos || "", ","))
        if (match(position, /^\+?[0-9]+$/) && int(position) <= 5) invalid("TLS record positions must be after the first 5 header bytes");
    if (options.segment_order && index([ "none", "fake", "oob", "tlsrec" ], mode) >= 0)
        invalid("segment_order requires a TCP segmentation mode");
    let fake_delay = options.fake_delay == null || options.fake_delay == "0" ? 0 : duration(options.fake_delay, "fake_delay", 1);
    if (!fake && (options.fake_placement || fake_delay > 0 || options.fake_tls_random || options.fake_tls_size || options.fake_tls_template))
        invalid("fake placement, delay and TLS transformations require a fake mode");
    if (index([ "between", "before_between" ], options.fake_placement) >= 0 && index([ "fake", "oob" ], mode) >= 0)
        invalid("interleaved fake placement requires a TCP segmentation mode");
    if (options.hostfake_mode && mode != "hostfakesplit") invalid("hostfake_mode requires mode=hostfakesplit");
    if (options.hostfake_mode == "replace" && (options.fake_payload || options.fake_tls_random || options.fake_tls_size || options.fake_tls_template))
        invalid("hostfake_mode=replace requires a length-preserving generated decoy");
    if (options.quic_split_pos || options.quic_order) {
        let udp_mode = options.udp_mode ?? (index([ "GT1", "GT2", "GT3", "GT4" ], options.preset) >= 0 ? "auto" : "none");
        if (index([ "quic", "auto" ], udp_mode) < 0) invalid("QUIC CRYPTO transformations require udp_mode=quic or auto");
        if (options.quic_desync === false) invalid("QUIC CRYPTO transformations require quic_desync=true");
        if (options.quic_order && !options.quic_split_pos) invalid("quic_order requires quic_split_pos");
    }
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
        else if (INTS[key] != null) integer(value, INTS[key], key, incomplete);
        else if (key == "fake_sni_pool") {
            if (type(value) != "array" || (!incomplete && length(value) > 64)) invalid("fake_sni_pool must contain at most 64 names");
            for (let name in value)
                if (type(name) != "string" || (!incomplete && (name == "" || length(name) > 253 || match(name, /[^A-Za-z0-9._-]/)))) invalid("invalid fake SNI pool name");
        }
        else if (key == "adaptive") {
            if (type(value) != "object") invalid("adaptive must be an object");
            for (let field, item in value) {
                if (ADAPTIVE[field] != null) integer(item, ADAPTIVE[field], "adaptive." + field, incomplete);
                else if (field == "ttl") duration(item, "adaptive.ttl", incomplete ? null : 604800, 60);
                else if (field == "timeout") duration(item, "adaptive.timeout", incomplete ? null : 60, 1);
                else if (field == "network_id") {
                    if (type(item) != "string" || (!incomplete && length(item) > 256) || (match(item, /[\r\n]/) || index(item, "\0") >= 0)) invalid("invalid adaptive.network_id");
                }
                else invalid("unknown adaptive option " + field);
            }
        }
        else invalid("unknown strategy option " + key);
    }
    // Imported fields must be well typed; their semantic values may be overridden.
    if (incomplete) {
        for (let key in [ "delay", "fake_delay" ])
            if (options[key] != null) duration(options[key], key);
        return options;
    }
    if (options.preset != null && options.preset != "" && index(PRESETS, options.preset) < 0) invalid("unknown preset " + options.preset);
    if (options.mode != null && index(MODES, options.mode) < 0) invalid("unknown mode " + options.mode);
    if (options.udp_mode != null && index([ "none", "quic", "stun", "auto" ], options.udp_mode) < 0) invalid("unknown UDP mode " + options.udp_mode);
    if (options.delay != null && options.delay != "0" && options.delay != "0s") duration(options.delay, "delay", 1);
    if (options.fake_delay != null && options.fake_delay != "0") duration(options.fake_delay, "fake_delay", 1);
    for (let key, choices in { fake_placement: [ "", "before", "between", "before_between" ], fake_tls_template: [ "", "original", "compact" ], hostfake_mode: [ "", "legacy", "replace" ] })
        if (options[key] != null && index(choices, options[key]) < 0) invalid("invalid " + key);
    for (let key in [ "tlsrec_pos", "quic_split_pos" ]) {
        let spec = options[key];
        if (spec == null || spec == "") continue;
        let positions = split(spec, ",");
        if (length(spec) > 1024 || length(positions) > 16) invalid(key + " supports at most 16 bounded markers");
        for (let position in positions)
            if (match(position, /^([1-9][0-9]*|(sni|sniext|host|midsld|endhost|extlen)([+-][0-9]+)?)$/) == null) invalid("invalid " + key + " " + position);
    }
    for (let key in [ "segment_order", "quic_order" ]) {
        let spec = options[key];
        if (spec == null || index([ "", "forward", "reverse", "sni_last" ], spec) >= 0) continue;
        let parts = split(spec, ","), seen = {};
        if (length(parts) > 17) invalid(key + " supports at most 17 segments");
        for (let part in parts) {
            let n = int(part);
            if (!match(part, /^\+?[0-9]+$/) || n < 1 || n > length(parts) || seen[n]) invalid(key + " must be forward, reverse, sni_last, or a one-based permutation");
            seen[n] = true;
        }
    }
    if (options.http_mod != null && options.http_mod != "") {
        let seen = {};
        for (let mod in split(options.http_mod, ",")) {
            if (index([ "hcsmix", "dcsmix", "rmspace" ], mod) < 0 || seen[mod]) invalid("http_mod requires unique hcsmix, dcsmix, rmspace tokens");
            seen[mod] = true;
        }
    }
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
    if (options.split_pos != null && options.split_pos != "") {
        let positions = split(options.split_pos, ",");
        if (length(positions) > 16) invalid("at most 16 split positions are allowed");
        for (let position in positions)
            if (match(trim(position), /^([1-9][0-9]*|(sni|sniext|host|midsld|endhost|extlen)([+-][0-9]+)?)$/) == null) invalid("invalid split position " + position);
    }
    if (options.udp_out_range != null && options.udp_out_range != "") {
        let range = match(options.udp_out_range, /^([0-9]+):([0-9]+)$/);
        if (range == null || int(range[1]) < 1 || int(range[2]) < int(range[1]) || int(range[2]) > 1024) invalid("udp_out_range must be start:end, 1..1024 inclusive");
    }
    if (!incomplete) validate_extensions(options);
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
            if (!match(value, /^-?(0|[1-9][0-9]*)$/)) invalid(key + " must be an integer");
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
    let embedded = result.strategy;
    delete result.strategy;
    if (embedded != null) result = { ...import_strategy(embedded), ...result };
    if (result.preset == null) result.preset = "auto";
    return validate(result);
}

function support_problem(current, capabilities) {
    if (!features.desync_version_supported(current))
        return "Desync requires sing-box-forkop " + REQUIRED_VERSION + " or newer";
    if (!features.desync_capabilities_supported(capabilities))
        return type(capabilities?.reason) == "string" && capabilities.reason != "" ? capabilities.reason : "This core does not advertise supported forkop-desync-v1";
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
