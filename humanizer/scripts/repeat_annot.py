"""Repeat the annotation of a rewritten text N times to measure verdict stability."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_annotate as A
txt, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
S = A.Scorer(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_narrative"))
text = open(txt).read(); res = []
for k in range(n):
    norm, raw, info = A.annotate(text, workers=10)
    s = S.score(norm); res.append({"run": k + 1, "p_human": s["p_human"], "pred_six": s["pred_six"], "features": norm})
    print(k + 1, round(s["p_human"], 3), s["pred_six"], flush=True)
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
