let t = require("t");
let fs = require("fs");
let stub = require("stub");
let repo = require("repo");
let exec = require("core.exec");

// Run the real installer's functions with downloads and package manager commands replaced.
// Its main entry point never runs, so these tests touch only their temporary directory.
let source = replace(fs.readfile(repo.path("install.sh")), /\nmain "\$@"\s*$/, "\n");

function shell(body, expected_status) {
    let dir = stub.tmpdir();
    let script = dir + "/test.sh";
    fs.writefile(script, source + "\nWORK=" + exec.command_line([ dir ]) + `
LOG=/dev/null
FORKOP_OLD=2.0.0 APP_OLD=2.0.0 I18N_OLD=2.0.0 CORE_OLD=1.14.4-r6 CORE_OLD_VARIANT=full
step() { :; }
log() { :; }
may_ask() { return 1; }
vercmp() { echo 0; }
older() { return 1; }
core_has_phobos() { return 0; }
download() { printf '%s\n' "$1" >>"$WORK/downloads"; : >"$2"; }
jsonfilter() {
    case "$*" in
        *@.install_command) printf '%s' "$INSTALL_COMMAND";;
        *) echo https://assets.example/release.json;;
    esac
}

read_manifest() {
    if [ "$2" = forkop ]; then printf '2.0.0\n2.0.0\n1.14.4-r6\n';
    else printf '1.14.4-r6\nv1.14.4-r6\n2.0.0\n'; fi
}
` + body);
    let result = exec.capture([ "/bin/sh", script ]);
    t.eq(result.status, expected_status ?? 0, result.stdout);
    return trim(result.stdout);
}

t.test("installer API downloads use the saved token or an environment override, keeping it away from other hosts", () => {
    let result = shell(`
uci() { echo github_pat_saved; }
curl() { cat; printf '%s\\n' "$@"; }
wget() { printf '%s\\n' "$@"; }
fetch https://api.github.com/repos/miuirussia/forkop/releases/latest "$WORK/api"
GITHUB_TOKEN_OVERRIDE=' github_pat_override '
fetch https://api.github.com/repos/miuirussia/forkop/releases/assets/1 "$WORK/asset" application/octet-stream
fetch https://mirror.example/file "$WORK/mirror"
fetch https://api.github.com.evil.example/file "$WORK/other"
MIRROR=https://api.github.com
fetch https://api.github.com/mirror/file "$WORK/mirror"
`);
    let lines = split(result, "\n");
    t.eq(length(filter(lines, (line) => index(line, "github_pat_") != -1)), 2);
    t.eq(length(filter(lines, (line) => line == "Authorization: Bearer github_pat_saved")), 1);
    t.eq(length(filter(lines, (line) => line == "Authorization: Bearer github_pat_override")), 1);
    t.contains(result, "--header=Accept: application/octet-stream");
    t.excludes(shell(`
uci() { return 1; }
wget() { printf '%s\\n' "$@"; }
fetch https://api.github.com/rate_limit "$WORK/api"
`), "Authorization");
});

t.test("an authenticated standalone download without curl tells the user how to install it", () => {
    for (let manager in [ "apk", "opkg" ]) {
        let result = shell(`
PM=` + manager + `
GITHUB_TOKEN_OVERRIDE=github_pat_test
command() { return 1; }
fetch https://api.github.com/rate_limit "$WORK/api" 2>&1
`, 1);
        t.contains(result, "Install curl to use a GitHub token");
        t.contains(result, manager == "apk" ? "apk add curl" : "opkg install curl");
        t.excludes(result, "github_pat_test");
    }
});

t.test("reinstall selects installed releases and forces Forkop, its page, translation and the same core build", () => {
    let result = shell(`
parse_args --reinstall --quiet --lang ru
resolve_release
printf '%s\n' "$BAD_ARG|$REINSTALL|$NEED_FORKOP$NEED_APP$NEED_I18N|$CORE_ACTION|$CORE_REINSTALL|$RESULT_CORE|$RESULT_VARIANT|$OPKG_FLAGS"
cat "$WORK/downloads"
`);
    t.eq(split(result, "\n"), [
        "|1|111|install|1|1.14.4-r6|full|--force-reinstall",
        "https://api.github.com/repos/miuirussia/forkop/releases/tags/2.0.0",
        "https://assets.example/release.json",
        "https://api.github.com/repos/miuirussia/sing-box-forkop/releases/tags/v1.14.4-r6",
        "https://assets.example/release.json"
    ]);
});

t.test("a mirror supplies the installed releases, while a regular update still asks for latest", () => {
    t.eq(shell(`
REINSTALL=1 MIRROR=https://mirror.example
resolve_release
cat "$WORK/downloads"
`), "https://mirror.example/miuirussia/forkop/releases/download/2.0.0/release.json\n" +
        "https://mirror.example/miuirussia/sing-box-forkop/releases/download/v1.14.4-r6/release.json");
    let update = shell(`
resolve_release
printf '%s\n' "$NEED_FORKOP$NEED_APP$NEED_I18N|$CORE_ACTION|$CORE_REINSTALL|$OPKG_FLAGS"
cat "$WORK/downloads"
`);
    t.contains(update, "000|none|0|");
    t.contains(update, "https://api.github.com/repos/miuirussia/forkop/releases/latest");
    t.contains(update, "https://api.github.com/repos/miuirussia/sing-box-forkop/releases/latest");
});

t.test("reinstall asks for the interface translation and removes the old translation for English", () => {
    for (let russian in [ true, false ]) {
        let result = shell(`
REINSTALL=1 CORE_ACTION=install I18N=1
may_ask() { return 0; }
question_block() { :; }
ask() { printf '%s\n' "$1"; return ` + (russian ? "0" : "1") + `; }
choose_translation
plan_removals
printf '%s\n' "$I18N|$NEED_I18N|$REMOVE_PKGS"
`);
        t.eq(split(result, "\n"), [ "Install the Russian translation of the Forkop page?",
            russian ? "1|1|" : "0|0|luci-i18n-forkop-ru" ]);
    }
});

t.test("an explicit translation choice decides which package to keep without asking", () => {
    for (let choice in [ "keep", "ru", "en" ]) {
        let result = shell(`
parse_args --reinstall --translation=` + choice + `
CORE_ACTION=install
I18N=1 NEED_I18N=1
may_ask() { echo "unexpected prompt"; return 0; }
choose_translation
plan_removals
printf '%s\\n' "$BAD_ARG|$I18N|$NEED_I18N|$REMOVE_PKGS"
`);
        t.eq(result, choice == "en" ? "|0|0|luci-i18n-forkop-ru" : "|1|1|");
    }
    t.eq(shell(`
parse_args --reinstall --translation=ru
I18N_OLD=''
decide_forkop
choose_translation
printf '%s\\n' "$BAD_ARG|$I18N|$NEED_I18N"
`), "|1|1");
});

t.test("reinstall refuses a third-party package and an apk without reinstall support before downloading", () => {
    for (let fixture in [
        [ "FORK_URL=https://fork.example", "foreign_fork" ],
        [ "PM=apk\napk() { echo 'apk add help'; }", "apk_reinstall" ]
    ]) {
        t.eq(shell(fixture[0] + `
REINSTALL=1
download() { echo 'unexpected download'; }
fail() { printf '%s\\n' "$2"; exit "$1"; }
resolve_release
`, 1), fixture[1]);
    }
    t.contains(shell(`
REINSTALL=1 PM=apk
apk() { printf '%s\\n' '  --force-reinstall'; }
resolve_release
cat "$WORK/downloads"
`), "/releases/tags/2.0.0");
});

t.test("LuCI reinstall checks the installed release's console-only command before fetching the core", () => {
    let result = shell(`
REINSTALL=1 FORKOP_INSTALL_FROM_LUCI=1 INSTALL_COMMAND='sh installer-from-console.sh'
finish() { cat "$WORK/downloads"; printf '%s\\n' "$2"; exit "$1"; }
resolve_release
`, 1);
    t.eq(split(result, "\n"), [
        "[!] Forkop 2.0.0 installs only with this command in a console:",
        "sh installer-from-console.sh",
        "https://api.github.com/repos/miuirussia/forkop/releases/tags/2.0.0",
        "https://assets.example/release.json",
        "command_only"
    ]);
});

t.test("reinstall cannot be combined with removal or changing the core build", () => {
    for (let args in [ "--uninstall", "--variant tiny", "--variant" ])
        t.eq(shell("parse_args --reinstall " + args + "\nprintf '%s' \"$BAD_ARG\"\n"), "reinstall");
    for (let args in [ "--translation=ru", "--reinstall --translation=de", "--reinstall --translation=" ])
        t.eq(shell("parse_args " + args + "\nprintf '%s' \"$BAD_ARG\"\n"), "translation");
});

t.test("both package managers simulate and perform forced reinstalls, including the core", () => {
    for (let pm in [ "opkg", "apk" ]) {
        let result = shell(`
REINSTALL=1 PM=` + pm + ` CORE_REINSTALL=1 OPKG_FLAGS=--force-reinstall
FILE_CORE=core.pkg FILE_FORKOP=forkop.pkg FILE_APP=page.pkg FILE_I18N=ru.pkg
capture() {
    out=$1
    shift
    printf '%s\n' "$*"
    printf 'Installing forkop (2.0.0)\nInstalling luci-app-forkop (2.0.0)\nInstalling luci-i18n-forkop-ru (2.0.0)\n' >"$out"
}
perform() { shift; printf '%s\n' "$*"; }
cp() { :; }
removals() { :; }
world_drop() { :; }
drop_dependencies() { :; }
refresh_db() { :; }
gone() { :; }
dropped() { :; }
check_installed() { return "$1"; }
preflight
transaction
`);
        if (pm == "apk") {
            t.contains(result, "apk add --simulate --allow-untrusted --no-network --repositories-file /dev/null --force-reinstall core.pkg forkop.pkg page.pkg ru.pkg");
            t.contains(result, "detached apk add --allow-untrusted --no-network --repositories-file /dev/null --force-reinstall core.pkg forkop.pkg page.pkg ru.pkg");
        }
        else {
            t.contains(result, "opkg --noaction --force-depends --force-overwrite --force-space --force-reinstall install core.pkg forkop.pkg page.pkg ru.pkg");
            t.contains(result, "detached opkg install --force-reinstall --force-overwrite --force-space core.pkg");
            t.contains(result, "detached opkg install --force-overwrite --force-space --force-reinstall forkop.pkg page.pkg ru.pkg");
        }
    }
});

t.done();
