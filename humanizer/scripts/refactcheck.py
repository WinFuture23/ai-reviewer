"""Recompute the fact-check of existing humanize runs with the current FACTCHECK_PROMPT (keeps the old one as factcheck_prev)."""
import json, sys, os
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_humanize as H
SS = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad"
def one(fn):
    r = json.load(open(fn)); name = r["name"]
    orig = f"{SS}/texts/{name}.txt" if os.path.exists(f"{SS}/texts/{name}.txt") else f"{SS}/news/ai/{name}.txt"
    rew = fn.replace(".json", ".txt")
    fc = H.factcheck(open(orig).read(), open(rew).read())
    r["factcheck_prev"] = r.get("factcheck"); r["factcheck"] = fc
    json.dump(r, open(fn, "w"), indent=1, ensure_ascii=False)
    print(os.path.basename(fn), "fidelity", r["factcheck_prev"].get("fidelity_score"), "->", fc.get("fidelity_score"), "| invented", len(fc.get("invented_facts", [])), "altered", len(fc.get("altered_facts", [])), "dropped", len(fc.get("dropped_facts", [])), flush=True)
with ThreadPoolExecutor(max_workers=4) as ex:
    list(ex.map(one, sys.argv[1:]))
