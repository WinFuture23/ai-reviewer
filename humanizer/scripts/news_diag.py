"""News-domain diagnostics: which features separate human WinFuture news from AI mirror news,
and where the VW article (and its rewrites) sit on them. Output JSON for the prompt panel."""
import json, os, sys, glob, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_lib, news_domain as ND
SS = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad"
out = sys.argv[1]; version = sys.argv[2] if len(sys.argv) > 2 else None
FM = {f["id"]: f for f in ss_lib.load_taxonomy()}
df = ND.load_corpus()
NS = ND.NewsSpace(df, variant="narrative")
gaps = NS.feature_gaps()
# raw (un-encoded) prevalence/means per feature for readability
def raw_summary(fid, sub):
    vals = sub[fid].astype(str)
    f = FM[fid]
    if f["type"] in ("scale", "ordinal"):
        enc = ss_lib.Encoder([f]); x = enc.encode(sub); return f"mean {np.nanmean(x):.2f}"
    return ", ".join(f"{k} {v:.0%}" for k, v in vals.value_counts(normalize=True).head(3).items())
hum, ai = df[df.label == "human"], df[df.label == "ai"]
top = []
seen = set()
for _, g in gaps.iterrows():
    fid = g.col.split("__")[0]
    if fid in seen:
        continue
    seen.add(fid)
    top.append({"feature": fid, "name": FM[fid]["name"], "question": FM[fid]["question"], "gap_z_human_minus_ai": round(float(g.gap_z), 2),
                "human_news": raw_summary(fid, hum), "ai_news": raw_summary(fid, ai), "values": FM[fid]["values"][:8]})
    if len(top) >= 30:
        break
texts = {}
for name in ["vw_161566_original", "wf_161565_gates", "wf_112000_human2019"]:
    fd = json.load(open(f"{SS}/annot2/{name}.run1.json"))["features"]
    texts[name] = {"original": {"score": NS.score(fd), "values_on_top_features": {t["feature"]: fd.get(t["feature"]) for t in top}}}
    if version:
        for f in sorted(glob.glob(f"{SS}/runs/{version}/{name}.s*.json")):
            r = json.load(open(f)); fr = r["annotations"][0]["features"]
            texts[name][f"{version}_s{r['sample']}"] = {"score": NS.score(fr), "factcheck": r["factcheck"], "values_on_top_features": {t["feature"]: fr.get(t["feature"]) for t in top}}
res = {"corpus": {"n_human": int(len(hum)), "n_ai": int(len(ai)), "loo_auc_narrative": NS.loo["auc"], "loo_acc_narrative": NS.loo["acc"], "loo_core30": NS.loo_core},
       "top_separating_features": top, "texts": texts}
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False, default=float)
print(json.dumps(res["corpus"], indent=1))
for t in top[:25]:
    print(f"  {t['gap_z_human_minus_ai']:+.2f} {t['feature']:15} {t['name'][:42]:42} | H: {t['human_news'][:60]} | AI: {t['ai_news'][:60]}")
for n, d in texts.items():
    print(n, {k: (round(v['score']['p_human_news'], 3), v['score']['nearest']) for k, v in d.items()})
