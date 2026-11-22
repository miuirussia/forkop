let common = require("core.common");

function ports(settings) {
    let values = common.list_option(settings, "autodetect_ports");
    if (length(values) == 0)
        values = [ "443" ];
    let result = [];
    for (let value in values) {
        value = trim(common.as_string(value));
        if (match(value, /^[0-9]+$/) == null || int(value, 10) < 1 || int(value, 10) > 65535)
            die("Autodetect: 'autodetect_ports' must contain HTTPS port numbers from 1 to 65535");
        let port = int(value, 10);
        if (index(result, port) < 0)
            push(result, port);
    }
    return result;
}

return { ports };
