// phobos:// carries a base64url WireGuard config, not an outbound share URI.
let ip = require("core.ip");

function invalid() { die("Invalid Phobos WireGuard link"); }
function uint(value, max) {
    if (type(value) != "string" || match(value, /^[0-9]+$/) == null) invalid();
    let number = int(value, 10);
    if (number < 0 || number > max) invalid();
    return number;
}
function key(value) {
    if (type(value) != "string" || match(value, /^[A-Za-z0-9+\/]{43}=$/) == null) invalid();
    return value;
}
function prefixes(value) {
    let result = map(split(value ?? "", ","), (item) => trim(item));
    if (length(result) == 0) invalid();
    for (let item in result)
        if (!ip.valid_ip_cidr(item)) invalid();
    return result;
}
function endpoint(link) {
    let uri = match(trim(link), /^phobos:\/\/([A-Za-z0-9_-]+)(#[^\r\n]*)?$/i);
    if (uri == null || length(uri[1]) > 1398104 || length(uri[1]) % 4 == 1) invalid();
    let encoded = replace(replace(uri[1], /-/g, "+"), /_/g, "/");
    while (length(encoded) % 4) encoded += "=";
    let text;
    try { text = b64dec(encoded); } catch (e) { invalid(); }
    if (text == null || length(text) > 1048576) invalid();
    let sections = {};
    let current = null;
    for (let line in split(text, "\n")) {
        line = trim(replace(line, /#.*$/, ""));
        if (line == "" || substr(line, 0, 1) == ";") continue;
        let header = match(line, /^\[([^\]]+)\]$/);
        if (header != null) {
            let name = lc(trim(header[1]));
            if (sections[name] != null) invalid();
            sections[name] = {};
            current = sections[name];
            continue;
        }
        let separator = index(line, "=");
        if (current == null || separator < 1) invalid();
        let name = replace(lc(trim(substr(line, 0, separator))), /[-_ \t]/g, "");
        let value = trim(substr(line, separator + 1));
        if (value == "none") continue;
        if (current[name] != null) invalid();
        current[name] = value;
    }
    let obf = sections.instance;
    if (obf?.mode == "socks5") die("Phobos SOCKS5 is not supported");
    let iface = sections.interface;
    let peer = sections.peer;
    if (iface == null || peer == null || obf == null ||
        (obf.mode != null && lc(obf.mode) != "wireguard") ||
        (obf.role != null && lc(obf.role) != "client")) invalid();
    let remote = match(obf.target ?? "", /^(\[[^\]]+\]|[^: \t\r\n]+):([0-9]+)$/);
    if (remote == null) invalid();
    let address = remote[1];
    if (substr(address, 0, 1) == "[") address = substr(address, 1, length(address) - 2);
    let port = uint(remote[2], 65535);
    if (port == 0) invalid();
    let server = { address, port, public_key: key(peer.publickey), allowed_ips: prefixes(peer.allowedips) };
    if (peer.presharedkey != null) server.pre_shared_key = key(peer.presharedkey);
    if (peer.persistentkeepalive != null && lc(peer.persistentkeepalive) != "off")
        server.persistent_keepalive_interval = uint(peer.persistentkeepalive, 4294967295);
    if (type(obf.key) != "string" || length(obf.key) < 1 || length(obf.key) > 255 || index(obf.key, chr(0)) >= 0) invalid();
    let obfuscation = { key: obf.key };
    if (obf.masking != null) {
        obfuscation.masking = uc(obf.masking);
        if (index([ "STUN", "MEDIA", "AUTO", "NONE" ], obfuscation.masking) < 0) invalid();
    }
    let limits = { max_dummy: 1024, obfuscate_bytes: 2147483647, media_pt: 127, media_ssrc: 4294967295, media_clock: 1000 };
    for (let name, max in limits) {
        let value = obf[replace(name, /_/g, "")];
        if (value != null) obfuscation[name] = uint(value, max);
    }
    let result = { type: "phobos", address: prefixes(iface.address), private_key: key(iface.privatekey), peers: [ server ], obfuscation };
    if (iface.mtu != null) {
        result.mtu = uint(iface.mtu, 65535);
        if (result.mtu == 0) invalid();
    }
    return result;
}
return { endpoint };
