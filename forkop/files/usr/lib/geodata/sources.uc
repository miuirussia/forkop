// DAT references stay independent of URLs and of generated SRS paths.
let fs = require("fs");
let common = require("core.common");
let uci = require("core.uci");

function parse(reference) {
    let matched = match(common.as_string(reference), /^dat:([A-Za-z0-9_]+):([a-z0-9_.!+-]+(@!?[a-z0-9_.+-]+)?)$/);
    return matched == null ? null : { source: matched[1], tag: matched[2] };
}

function all() { return uci.section_objects("forkop", "geodata"); }
function get(id) {
    for (let source in all())
        if (source[".name"] == id)
            return source;
    return null;
}

function root() {
    let value = common.option(uci.get_all("forkop", "settings") ?? {}, "geodata_path", "/tmp/forkop-geodata");
    if (substr(value, 0, 1) != "/" || match(value, /(^|\/)\.\.?($|\/)|[\r\n]/) || value == "/")
        die("Invalid geodata storage directory");
    return replace(value, /\/+$/, "");
}

function directory(id) {
    if (match(common.as_string(id), /^[A-Za-z0-9_]+$/) == null)
        die("Invalid geodata source ID");
    return root() + "/" + id;
}

function active(id) { return common.read_json_file(directory(id) + "/active.json"); }
function signature(path) {
    let stat = fs.stat(path);
    return stat == null ? "" : sprintf("%s:%s:%s", stat.inode, stat.size, stat.mtime);
}

function resolve(reference) {
    let ref = parse(reference);
    if (ref == null || get(ref.source) == null)
        die("Unknown DAT rule set '" + reference + "'");
    let state = active(ref.source);
    let path = state?.directory + "/" + ref.tag + ".srs";
    if (state == null || fs.stat(path) == null)
        die("DAT rule set '" + reference + "' is not prepared; download the source on the Geodata tab");
    return path;
}

function is_geoip(reference) {
    let ref = parse(reference);
    return ref != null && get(ref.source)?.kind == "geoip";
}

function used() {
    let result = {};
    for (let section in uci.section_objects("forkop", "section")) {
        if (!common.bool_option(section, "enabled", true))
            continue;
        for (let reference in [ ...common.list_option(section, "rule_set"), ...common.list_option(section, "rule_set_with_subnets") ]) {
            let ref = parse(reference);
            if (ref == null)
                continue;
            result[ref.source] ??= [];
            if (index(result[ref.source], ref.tag) < 0)
                push(result[ref.source], ref.tag);
        }
    }
    return result;
}

return { parse, all, get, root, directory, active, signature, resolve, is_geoip, used };
