#!/usr/bin/env python3
"""
Filter lists (EasyList format) ko Chrome ke declarativeNetRequest rules
aur cosmetic (CSS) data mein convert karta hai.

Use:  python3 build/build_filters.py <lists_folder>
Output: rules/*.json, filters/cosmetic.json, filters/popup.json
"""
import json, os, re, sys
from collections import defaultdict

LISTS = sys.argv[1] if len(sys.argv) > 1 else "lists"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ruleset id -> source files
RULESETS = {
    "ads":        ["easylist.txt"],
    "privacy":    ["easyprivacy.txt"],
    "annoyances": ["fanboy-annoyance.txt", "annoyances-cookies.txt"],
    "antiadblock":["antiadblock_english.txt", "filters.txt", "quick-fixes.txt"],
    "malware":    ["badware.txt"],
}

TYPE_MAP = {
    "script": "script", "image": "image", "stylesheet": "stylesheet",
    "object": "object", "xmlhttprequest": "xmlhttprequest", "xhr": "xmlhttprequest",
    "subdocument": "sub_frame", "frame": "sub_frame", "ping": "ping", "beacon": "ping",
    "media": "media", "font": "font", "websocket": "websocket", "other": "other",
    "document": "main_frame", "doc": "main_frame",
}
SUB_TYPES = ["sub_frame", "stylesheet", "script", "image", "font", "object",
             "xmlhttprequest", "ping", "media", "websocket", "other"]
IGNORED_OPTS = {"match-case", "important", "third-party", "3p", "~third-party", "1p",
                "first-party", "~first-party", "all", "strict3p", "strict1p"}
# options hum support nahi karte -> poora filter skip
UNSUPPORTED = {"csp", "rewrite", "redirect", "redirect-rule", "removeparam", "header",
               "sitekey", "webrtc", "genericblock", "replace", "permissions",
               "urlskip", "uritransform", "to", "from", "method", "denyallow",
               "inline-script", "inline-font", "empty", "mp4", "cname", "ipaddress",
               "urltransform", "badfilter", "elemhide", "ehide", "generichide",
               "ghide", "specifichide", "shide", "content", "~popup", "popunder"}

ASCII = re.compile(r"^[\x20-\x7e]+$")
DOMAIN_ONLY = re.compile(r"^\|\|([a-z0-9.\-_]+)\^?$")


def valid_domain(d):
    return bool(d) and ASCII.match(d) and "*" not in d and "/" not in d and "." in d


def parse_domains(value):
    inc, exc = [], []
    for d in value.split("|"):
        d = d.strip().lower()
        if not d:
            continue
        neg = d.startswith("~")
        d = d.lstrip("~")
        if not valid_domain(d):
            return None
        (exc if neg else inc).append(d)
    return inc, exc


class Out:
    def __init__(self):
        self.rules = []
        self.block_domains = defaultdict(set)   # (domainType, priority) -> domains
        self.allow_domains = set()
        self.doc_block = set()                  # main_frame block (malware)
        self.next_id = 1

        self.next_allow = 500000

    def add(self, rule):
        if rule["action"]["type"] in ("allow", "allowAllRequests"):
            rule["id"] = self.next_allow
            self.next_allow += 1
        else:
            rule["id"] = self.next_id
            self.next_id += 1
        self.rules.append(rule)


class Cos:
    def __init__(self):
        self.generic = set()
        self.generic_exc = defaultdict(set)   # selector -> domains where not applied
        self.specific = defaultdict(set)      # domain -> selectors
        self.exc = defaultdict(set)           # domain -> selectors (#@#)

COS = {rs: Cos() for rs in RULESETS}
CUR = ["ads"]
generichide = set()                         # domains with no generic cosmetics
popup_patterns = set()


def handle_cosmetic(line):
    m = re.match(r"^([^#]*)(#@?\??#)(.+)$", line)
    if not m:
        return
    doms, sep, sel = m.group(1), m.group(2), m.group(3).strip()
    if sep in ("#?#", "#@?#"):
        if ":-abp-contains" in sel or ":-abp-properties" in sel:
            return
        sel = sel.replace(":-abp-has(", ":has(")
    # uBO procedural / scriptlet syntax skip
    if sel.startswith("+js") or sel.startswith("^") or any(x in sel for x in (
        ":has-text(", ":upward(", ":style(", ":remove(", ":xpath(", ":matches-css",
        ":min-text-length", ":watch-attr", ":matches-path", ":others(", ":-abp-",
        ":remove-attr", ":remove-class", ":matches-attr", ":matches-prop", ":matches-media")):
        return
    if not ASCII.match(sel) or "{" in sel or "}" in sel:
        return
    inc, exc = [], []
    for d in doms.split(","):
        d = d.strip().lower()
        if not d or d == "*":
            continue
        if d.startswith("~"):
            exc.append(d[1:])
        else:
            inc.append(d)
    if any("/" in d or not ASCII.match(d) for d in inc + exc):
        return
    is_exc = "@" in sep
    c = COS[CUR[0]]
    if not inc:
        if is_exc:
            return  # global exception: rare, ignore
        c.generic.add(sel)
        for d in exc:
            c.generic_exc[sel].add(d)
        return
    for d in inc:
        (c.exc if is_exc else c.specific)[d].add(sel)


def handle_network(line, out, ruleset):
    allow = line.startswith("@@")
    if allow:
        line = line[2:]
    pattern, opts = line, ""
    if "$" in line and not line.startswith("/"):
        pattern, _, opts = line.rpartition("$")
    elif line.startswith("/") and "$" in line:
        pattern, _, opts = line.rpartition("$")
    if pattern.startswith("/") and pattern.endswith("/") and len(pattern) > 2:
        return  # regex filters skip (Chrome limit + RE2 differences)

    cond = {}
    types, ex_types = [], []
    priority = 1
    popup = False
    for o in [x.strip() for x in opts.split(",") if x.strip()] if opts else []:
        name, _, val = o.partition("=")
        neg = name.startswith("~")
        base = name.lstrip("~").lower()
        if base in ("generichide", "ghide", "elemhide", "ehide") and allow and not neg:
            # cosmetic exception for domains
            d = DOMAIN_ONLY.match(pattern.lower())
            if d:
                generichide.add(d.group(1))
            return
        if name.lower() in UNSUPPORTED or base in UNSUPPORTED:
            return
        if base == "popup":
            popup = True
            continue
        if base in ("domain", "from"):
            pd = parse_domains(val)
            if pd is None:
                return
            if pd[0]:
                cond["initiatorDomains"] = pd[0]
            if pd[1]:
                cond["excludedInitiatorDomains"] = pd[1]
            continue
        if base in ("third-party", "3p"):
            cond["domainType"] = "firstParty" if neg else "thirdParty"
            continue
        if base in ("first-party", "1p"):
            cond["domainType"] = "thirdParty" if neg else "firstParty"
            continue
        if base == "match-case":
            cond["isUrlFilterCaseSensitive"] = True
            continue
        if base == "important":
            priority = 3
            continue
        if base == "all":
            types = SUB_TYPES + ["main_frame"]
            continue
        if base in TYPE_MAP:
            (ex_types if neg else types).append(TYPE_MAP[base])
            continue
        return  # unknown option -> skip safely

    if popup:
        if not allow and not types:
            popup_patterns.add(pattern)
        return

    if not pattern or pattern in ("*", "|", "||"):
        if not cond.get("initiatorDomains"):
            return
        pattern = "*"
    if not ASCII.match(pattern):
        return
    if pattern.startswith("||*"):
        pattern = pattern[3:] or "*"

    if types:
        cond["resourceTypes"] = sorted(set(types))
    elif ex_types:
        cond["excludedResourceTypes"] = sorted(set(ex_types))

    is_doc = "main_frame" in cond.get("resourceTypes", [])

    # aggregation: simple ||domain^ filters -> ek bada requestDomains rule
    dm = DOMAIN_ONLY.match(pattern.lower())
    simple = dm and set(cond) <= {"domainType", "resourceTypes"} and not cond.get("isUrlFilterCaseSensitive")
    if simple and valid_domain(dm.group(1)):
        dom = dm.group(1)
        if ruleset == "malware" and is_doc:
            out.doc_block.add(dom)
            return
        if not cond.get("resourceTypes") and not cond.get("excludedResourceTypes"):
            if allow and "domainType" not in cond:
                out.allow_domains.add(dom)
                return
            if not allow:
                out.block_domains[(cond.get("domainType"), priority)].add(dom)
                return

    if pattern == "*" and not cond.get("initiatorDomains") and not cond.get("resourceTypes"):
        return
    if len(pattern) < 4 and pattern != "*":
        return  # bahut generic, false positive ka risk

    if pattern != "*":
        cond["urlFilter"] = pattern

    if allow:
        if is_doc:
            cond["resourceTypes"] = ["main_frame", "sub_frame"]
            out.add({"priority": 2, "action": {"type": "allowAllRequests"}, "condition": cond})
        else:
            out.add({"priority": 2, "action": {"type": "allow"}, "condition": cond})
        return

    if is_doc:
        if ruleset != "malware":
            return  # main_frame block sirf malware ke liye
        cond["resourceTypes"] = ["main_frame"]
        out.add({"priority": 1, "action": {"type": "redirect",
                 "redirect": {"extensionPath": "/pages/blocked.html"}}, "condition": cond})
        return
    if "resourceTypes" not in cond and "excludedResourceTypes" not in cond:
        cond["resourceTypes"] = SUB_TYPES
    out.add({"priority": priority, "action": {"type": "block"}, "condition": cond})


def finish(out):
    for (dtype, prio), doms in sorted(out.block_domains.items(), key=lambda x: str(x[0])):
        cond = {"requestDomains": sorted(doms), "resourceTypes": SUB_TYPES}
        if dtype:
            cond["domainType"] = dtype
        out.add({"priority": prio, "action": {"type": "block"}, "condition": cond})
    if out.allow_domains:
        out.add({"priority": 2, "action": {"type": "allow"},
                 "condition": {"requestDomains": sorted(out.allow_domains)}})
    if out.doc_block:
        out.add({"priority": 1, "action": {"type": "redirect",
                 "redirect": {"extensionPath": "/pages/blocked.html"}},
                 "condition": {"requestDomains": sorted(out.doc_block), "resourceTypes": ["main_frame"]}})
        out.add({"priority": 1, "action": {"type": "block"},
                 "condition": {"requestDomains": sorted(out.doc_block), "resourceTypes": SUB_TYPES}})


def main():
    os.makedirs(os.path.join(ROOT, "rules"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "filters"), exist_ok=True)
    total = 0
    for rs, files in RULESETS.items():
        out = Out()
        CUR[0] = rs
        for f in files:
            path = os.path.join(LISTS, f)
            if not os.path.exists(path):
                print("missing", path)
                continue
            for raw in open(path, encoding="utf-8", errors="ignore"):
                line = raw.strip()
                if not line or line.startswith("!") or line.startswith("[") or line.startswith("#"):
                    if line.startswith("##") or line.startswith("#@#") or line.startswith("#?#"):
                        handle_cosmetic(line)
                    continue
                if re.search(r"#@?\??#", line) and not line.startswith("/"):
                    handle_cosmetic(line)
                    continue
                if "#$#" in line or "#%#" in line:
                    continue
                handle_network(line, out, rs)
        finish(out)
        json.dump(out.rules, open(os.path.join(ROOT, "rules", rs + ".json"), "w"), separators=(",", ":"))
        print(f"{rs}: {len(out.rules)} rules")
        total += len(out.rules)
    print("TOTAL rules:", total)

    bad_path = os.path.join(ROOT, "build", "invalid_selectors.json")
    bad = set(json.load(open(bad_path))) if os.path.exists(bad_path) else set()
    cos = {"generichide": sorted(generichide), "sets": {}}
    for rs, c in COS.items():
        c.generic -= bad
        for k in list(c.specific):
            c.specific[k] -= bad
        cos["sets"][rs] = {
            "generic": sorted(c.generic),
            "genericExceptions": {k: sorted(v) for k, v in c.generic_exc.items()},
            "specific": {k: sorted(v) for k, v in c.specific.items()},
            "exceptions": {k: sorted(v) for k, v in c.exc.items()},
        }
        print(f"cosmetic {rs}: generic {len(c.generic)}, sites {len(c.specific)}")
    json.dump(cos, open(os.path.join(ROOT, "filters", "cosmetic.json"), "w"), separators=(",", ":"))
    json.dump(sorted(popup_patterns), open(os.path.join(ROOT, "filters", "popup.json"), "w"))
    print("popup patterns:", len(popup_patterns))


if __name__ == "__main__":
    main()
