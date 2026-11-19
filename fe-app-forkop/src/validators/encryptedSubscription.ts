// Mirrors singbox/subscription_crypto.uc. The router validates the decrypted URL.
export const ENCRYPTED_SUBSCRIPTION_SOURCE =
  /^\s*(?=\S{1,16400}\s*$)(?:incy:\/\/crypt1\/[a-z0-9_-]+\/*|happ:\/\/crypt[2345]?\/[a-z0-9_+=:/-]+)\s*$/i;
