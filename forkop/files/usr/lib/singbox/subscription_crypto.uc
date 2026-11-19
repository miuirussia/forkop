let common = require("core.common");

// The core decrypts these URLs while creating its remote provider.
function client(value) {
    value = trim(common.as_string(value));
    if (length(value) > 16400)
        return null;

    if (match(value, /^incy:\/\/crypt1\/[a-zA-Z0-9_-]+\/*$/i) != null)
        return "incy";

    if (match(value, /^happ:\/\/crypt[2345]?\/[a-zA-Z0-9_+=:\/-]+$/i) != null)
        return "happ";

    return null;
}

return { client };
