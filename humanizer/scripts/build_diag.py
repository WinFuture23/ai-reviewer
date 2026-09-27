"""Aggregate diagnostics for one prompt version -> JSON for the prompt panel + a printed summary.
Usage: python3 build_diag.py <version> <out.json> [--news]"""
import json, os, sys, glob
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_annotate as A, diagnose as DG, ss_lib
SS = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad"
version, out = sys.argv[1], sys.argv[2]
S = A.Scorer("out_narrative")
FM = {f["id"]: f for f in ss_lib.load_taxonomy()}
diag = {"version": version, "texts": [], "aggregate_toward_ai": {}}
agg = {}
for f in sorted(glob.glob(f"{SS}/runs/{version}/*.s*.json")):
    r = json.load(open(f)); name = r["name"]
    orig_fn = f"{SS}/annot2/{name}.run1.json" if os.path.exists(f"{SS}/annot2/{name}.run1.json") else f"{SS}/news/annot/{name}.run1.json"
    fo = json.load(open(orig_fn))["features"]; fr = r["annotations"][0]["features"]
    so, sr = S.score(fo), S.score(fr)
    ex = DG.explain(S, fr, topk=20)
    changed = [fid for fid in FM if str(fo.get(fid)) != str(fr.get(fid))]
    t = {"text": name, "sample": r["sample"], "words_orig": r["words_orig"], "words_rewrite": r["words_rew"],
         "p_human_before": round(so["p_human"], 4), "p_human_after": round(sr["p_human"], 4), "logit_after": round(ex["logit_total"], 2),
         "factcheck": r["factcheck"], "n_features_changed": len(changed),
         "still_toward_ai_after_rewrite": [{"feature": d["fid"], "name": d["name"], "question": d["question"], "rewrite_value": d["value"], "original_value": fo.get(d["fid"]),
                                            "contribution_to_ai_logit": round(d["contrib"], 3), "columns": d["cols"][:3]} for d in ex["toward_ai"]],
         "now_toward_human": [{"feature": d["fid"], "name": d["name"], "rewrite_value": d["value"], "contribution": round(d["contrib"], 3)} for d in ex["toward_human"][:8]]}
    diag["texts"].append(t)
    for d in ex["toward_ai"]:
        a = agg.setdefault(d["fid"], {"feature": d["fid"], "name": d["name"], "question": d["question"], "sum_contrib": 0.0, "n_texts": 0, "values": []})
        a["sum_contrib"] += d["contrib"]; a["n_texts"] += 1; a["values"].append(str(d["value"])[:60])
diag["aggregate_toward_ai"] = sorted(agg.values(), key=lambda a: a["sum_contrib"])[:25]
json.dump(diag, open(out, "w"), indent=1, ensure_ascii=False)
for t in diag["texts"]:
    print(f"{t['text']:28} s{t['sample']} p_h {t['p_human_before']:.3f} -> {t['p_human_after']:.3f}  logit {t['logit_after']:+.1f}  fidelity {t['factcheck'].get('fidelity_score')}  changed feats {t['n_features_changed']}")
print("\nAGGREGATE still toward AI:")
for a in diag["aggregate_toward_ai"][:20]:
    print(f"  {a['sum_contrib']:+.2f} ({a['n_texts']}) {a['feature']:15} {a['name'][:45]:45} {a['values'][:3]}")
