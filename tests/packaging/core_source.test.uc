let t = require("t");
let fs = require("fs");
let repo = require("repo");
let source = fs.readfile(repo.path("install.sh"));
let start = index(source, "decide_core() {");
let body = substr(source, start);
let decide = substr(body, 0, index(body, "\n}") + 2);
t.test("same-version WG builds are replaced only when they lack Phobos", () => {
    for (let variant in [ "base", "full", "tiny" ]) {
        for (let support in [ 0, 1 ]) {
            let script = getenv("FORKOP_TEST_TMP") + "/core-source.sh";
            fs.writefile(script, decide + "\n" +
                "check_compatible() { :; }\nvercmp() { echo 0; }\ncore_has_phobos() { return " + support + "; }\n" +
                "VARIANT=" + variant + " CORE_OLD=1.14.4-r1 CORE_OLD_VARIANT=" + variant + " C_VERSION=1.14.4-r1 CORE_ACTION=none CORE_REINSTALL=0\n" +
                "decide_core\nprintf '%s %s' \"$CORE_ACTION\" \"$CORE_REINSTALL\"\n");
            let pipe = fs.popen("sh '" + script + "'", "r");
            let result = pipe.read("all");
            t.eq(pipe.close(), 0);
            t.eq(result, variant != "tiny" && support == 1 ? "install 1" : "none 0", variant);
        }
    }
});
t.done();
