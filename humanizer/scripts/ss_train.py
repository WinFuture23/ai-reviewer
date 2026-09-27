"""Train StoryScope classifiers (binary + 6-way), LDA projection and kNN rarity
on the released feature parquet, paper-faithful. Usage:
  python3 ss_train.py --variant full|narrative [--exclude ids.json] --out DIR
"""
import argparse, json, pickle, time, sys
import numpy as np, pandas as pd
from sklearn.model_selection import GroupKFold
from sklearn.metrics import f1_score, average_precision_score, confusion_matrix, accuracy_score, classification_report
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.neighbors import NearestNeighbors
from xgboost import XGBClassifier
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import ss_lib

ap = argparse.ArgumentParser()
ap.add_argument("--variant", default="full")
ap.add_argument("--exclude", default=None, help="json list of extra feature ids to exclude")
ap.add_argument("--out", required=True)
ap.add_argument("--quick", action="store_true", help="fewer trees for smoke test")
args = ap.parse_args()
import os; os.makedirs(args.out, exist_ok=True)
log = lambda *a: print(time.strftime("%H:%M:%S"), *a, flush=True)

feats = ss_lib.load_taxonomy()
exclude = set()
if args.variant == "narrative":
    exclude |= {f["id"] for f in feats if f["dim_key"] == "style"}
if args.exclude:
    exclude |= set(json.load(open(args.exclude)))
enc = ss_lib.Encoder(feats, exclude_ids=exclude)
log(f"variant={args.variant} features={len(enc.feats)} encoded_cols={len(enc.cols)}")

df = ss_lib.load_features_df()
# keep only prompts present for all 6 sources (as the released code does)
cnt = df.groupby("prompt_id")["source"].nunique()
df = df[df.prompt_id.isin(cnt[cnt == 6].index)].reset_index(drop=True)
log(f"matched rows={len(df)} prompts={df.prompt_id.nunique()}")

t0 = time.time(); X = enc.encode(df); log(f"encoded {X.shape} in {time.time()-t0:.0f}s")
y_bin = (df.source == "human").astype(int).values
lab = {s: i for i, s in enumerate(ss_lib.SOURCES_SORTED)}
y_mc = df.source.map(lab).values
groups = df.prompt_id.values
gkf = GroupKFold(n_splits=5)
tr, te = next(gkf.split(X, y_bin, groups))
log(f"train={len(tr)} test={len(te)}")
np.save(f"{args.out}/test_idx.npy", te); np.save(f"{args.out}/train_idx.npy", tr)
df[["prompt_id", "story_title", "source"]].to_parquet(f"{args.out}/meta.parquet")

n_bin, n_mc = (60, 60) if args.quick else (420, 500)
# ---------------- binary ----------------
clf_b = XGBClassifier(n_estimators=n_bin, max_depth=8, reg_lambda=2.0, tree_method="hist",
                      n_jobs=4, random_state=42, eval_metric="logloss")
w = np.where(y_bin[tr] == 1, 5.0, 1.0)
t0 = time.time(); clf_b.fit(X[tr], y_bin[tr], sample_weight=w); log(f"binary trained {time.time()-t0:.0f}s")
p_b = clf_b.predict_proba(X[te])[:, 1]; pred_b = (p_b >= 0.5).astype(int)
m_bin = {"macro_f1": f1_score(y_bin[te], pred_b, average="macro"), "auprc": average_precision_score(y_bin[te], p_b),
         "human_f1": f1_score(y_bin[te], pred_b), "acc": accuracy_score(y_bin[te], pred_b)}
log("BINARY", m_bin)
clf_b.save_model(f"{args.out}/binary.json")
# ---------------- multiclass ----------------
clf_m = XGBClassifier(n_estimators=n_mc, max_depth=7, reg_lambda=1.0, tree_method="hist", n_jobs=4,
                      random_state=42, objective="multi:softprob", num_class=6, eval_metric="mlogloss")
t0 = time.time(); clf_m.fit(X[tr], y_mc[tr]); log(f"multiclass trained {time.time()-t0:.0f}s")
P_m = clf_m.predict_proba(X[te]); pred_m = P_m.argmax(1)
m_mc = {"macro_f1": f1_score(y_mc[te], pred_m, average="macro"), "acc": accuracy_score(y_mc[te], pred_m),
        "per_class_f1": dict(zip(ss_lib.SOURCES_SORTED, f1_score(y_mc[te], pred_m, average=None).tolist()))}
cm = confusion_matrix(y_mc[te], pred_m, labels=list(range(6)))
log("MULTICLASS", m_mc)
clf_m.save_model(f"{args.out}/multiclass.json")
# ---------------- z-score space, LDA, rarity ----------------
mu = np.nanmean(X[tr], axis=0); sd = np.nanstd(X[tr], axis=0)
keep = sd > 1e-6
def zs(A):
    A = np.where(np.isnan(A), mu, A)
    return ((A - mu) / np.where(keep, sd, 1.0))[:, keep].astype(np.float32)
Ztr, Zte = zs(X[tr]), zs(X[te])
lda = LinearDiscriminantAnalysis(solver="eigen", shrinkage="auto", n_components=2)
t0 = time.time(); lda.fit(Ztr, y_mc[tr]); log(f"LDA fit {time.time()-t0:.0f}s")
Ltr, Lte = lda.transform(Ztr), lda.transform(Zte)
np.save(f"{args.out}/lda_test.npy", Lte); np.save(f"{args.out}/lda_train.npy", Ltr)
# rarity: mean distance to 25 NN in train+val (= train here) z-space
nn = NearestNeighbors(n_neighbors=26, algorithm="brute", n_jobs=4)
t0 = time.time(); nn.fit(Ztr)
d_tr, _ = nn.kneighbors(Ztr); r_tr = d_tr[:, 1:].mean(1)          # exclude self
d_te, _ = nn.kneighbors(Zte, n_neighbors=25); r_te = d_te.mean(1)
log(f"rarity computed {time.time()-t0:.0f}s")
r_sorted = np.sort(r_tr)
pct_te = np.searchsorted(r_sorted, r_te) / len(r_sorted)
np.save(f"{args.out}/rarity_train.npy", r_tr); np.save(f"{args.out}/rarity_test_pct.npy", pct_te)
src_te = df.source.values[te]
rar = {s: {"mean_pct": float(pct_te[src_te == s].mean()), "median_pct": float(np.median(pct_te[src_te == s]))} for s in ss_lib.SOURCES_SORTED}
ai_pct = pct_te[src_te != "human"]; hu_pct = pct_te[src_te == "human"]
rar["human_vs_ai"] = {"human_mean": float(hu_pct.mean()), "ai_mean": float(ai_pct.mean())}
log("RARITY", rar)
# centroid distances in z-space (paper §5)
cents = {s: Ztr[y_mc[tr] == lab[s]].mean(0) for s in ss_lib.SOURCES_SORTED}
cd = {f"{a}-{b}": float(np.linalg.norm(cents[a] - cents[b])) for a in ss_lib.SOURCES_SORTED for b in ss_lib.SOURCES_SORTED if a < b}
# persist everything needed to score a new story
pickle.dump({"variant": args.variant, "exclude": sorted(exclude), "col_names": enc.col_names,
             "mu": mu, "sd": sd, "keep": keep, "lda": lda, "rarity_train_sorted": r_sorted,
             "lda_centroids": {s: Lte[src_te == s].mean(0).tolist() for s in ss_lib.SOURCES_SORTED},
             "sources": ss_lib.SOURCES_SORTED}, open(f"{args.out}/scorer.pkl", "wb"))
np.save(f"{args.out}/Ztr.npy", Ztr)
json.dump({"variant": args.variant, "n_features": len(enc.feats), "D": len(enc.cols), "n_train": int(len(tr)), "n_test": int(len(te)),
           "binary": m_bin, "multiclass": m_mc, "confusion_rows_actual_sorted": cm.tolist(),
           "rarity": rar, "centroid_dist": cd, "test_pred_binary_prob": p_b.tolist(), "test_pred_mc": P_m.tolist()},
          open(f"{args.out}/metrics.json", "w"), indent=1)
log("DONE")
