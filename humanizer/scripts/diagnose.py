"""Per-text SHAP-style attribution (XGBoost pred_contribs) -> which features push a text toward 'AI'."""
import json, os, sys, numpy as np, pandas as pd, xgboost as xgb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_lib, ss_annotate as A

_FM = {f["id"]: f for f in ss_lib.load_taxonomy()}
_REF = {}


def reference_means(scorer):
    """Column means for human / AI rows in the training split (cached per scorer variant)."""
    if scorer.variant in _REF:
        return _REF[scorer.variant]
    df = ss_lib.load_features_df()
    cnt = df.groupby("prompt_id")["source"].nunique(); df = df[df.prompt_id.isin(cnt[cnt == 6].index)].reset_index(drop=True)
    X = scorer.enc.encode(df)
    hum = np.nanmean(X[df.source.values == "human"], 0); ai = np.nanmean(X[df.source.values != "human"], 0)
    _REF[scorer.variant] = (hum, ai); return hum, ai


def explain(scorer, fd, topk=15):
    X = scorer.enc.encode(pd.DataFrame([fd]))
    booster = scorer.clf_b.get_booster()
    contrib = booster.predict(xgb.DMatrix(X), pred_contribs=True)[0]   # last = bias; positive -> human
    hum, ai = reference_means(scorer)
    per_feat = {}
    for j, (cn, fid, kind, val) in enumerate(scorer.enc.cols):
        per_feat.setdefault(fid, {"fid": fid, "name": _FM[fid]["name"], "question": _FM[fid]["question"], "contrib": 0.0, "cols": []})
        per_feat[fid]["contrib"] += float(contrib[j])
        if abs(contrib[j]) > 0.02:
            per_feat[fid]["cols"].append({"col": cn, "x": None if np.isnan(X[0, j]) else float(X[0, j]), "human_mean": round(float(hum[j]), 2), "ai_mean": round(float(ai[j]), 2), "contrib": round(float(contrib[j]), 3)})
    for fid in per_feat:
        per_feat[fid]["value"] = fd.get(fid)
    items = sorted(per_feat.values(), key=lambda d: d["contrib"])
    return {"logit_bias": float(contrib[-1]), "logit_total": float(contrib.sum()),
            "toward_ai": [{k: v for k, v in d.items()} for d in items[:topk]],
            "toward_human": [{k: v for k, v in d.items()} for d in items[::-1][:topk]]}


if __name__ == "__main__":
    S = A.Scorer("out_narrative")
    for path in sys.argv[1:]:
        r = json.load(open(path))
        fd = r["features"] if "features" in r else r["annotations"][0]["features"]
        ex = explain(S, fd, topk=12)
        print(f"\n=== {path}  logit={ex['logit_total']:+.2f} (bias {ex['logit_bias']:+.2f})  p_h={S.score(fd)['p_human']:.3f}")
        for d in ex["toward_ai"]:
            print(f"  {d['contrib']:+.2f} {d['fid']:15} {d['name'][:44]:44} value={str(d['value'])[:40]}")
