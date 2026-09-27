"""StoryScope method applied to the news domain: human WinFuture articles (2017-2020) vs. LLM mirror articles
written from reverse-engineered briefs. Same 304 features, same encoder; small-sample classifier with
leave-one-out validation; projection; per-feature human/AI gaps (the 'core features' of the news domain)."""
import json, os, sys, glob, pickle
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import LeaveOneOut, cross_val_predict
from sklearn.decomposition import PCA
from sklearn.metrics import roc_auc_score, accuracy_score
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_lib

NEWS = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad/news/annot"
FEATS = ss_lib.load_taxonomy()
STYLE = {f["id"] for f in FEATS if f["dim_key"] == "style"} | set(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "style_flagged_8.json"))))
CORE30 = ["SIT_MET_303","SIT_GEN_010","PLT_THM_008","SIT_MET_501","PER_DIA_003","SIT_MET_008","AGENT_EMO_009","SET_ATM_022","SET_LOC_014",
          "SET_ATM_017","SET_ATM_005","PER_FOC_001","EVT_CAU_002","SET_LOC_002","PLT_CON_007","AGENT_ATTR_001","PLT_THM_009","EVT_SCH_004",
          "SET_LOC_004","REV_SUS_007","SIT_MET_202","SIT_MET_004","PER_POV_009","REV_SUR_003","TMP_ORD_010","REV_DIS_003","TMP_ORD_002",
          "SET_LOC_011","PER_DIA_001","PLT_MOR_002"]


def load_corpus(path=NEWS):
    rows = []
    for f in sorted(glob.glob(f"{path}/*.json")):
        r = json.load(open(f)); n = r["name"]
        label = "ai" if "__" in n else "human"
        model = n.split("__")[1] if "__" in n else "human"
        rows.append({"name": n, "label": label, "model": model, **r["features"]})
    return pd.DataFrame(rows)


class NewsSpace:
    """Fit on the news corpus; score arbitrary feature dicts in the same space."""
    def __init__(self, df, variant="narrative", C=0.05):
        exclude = STYLE if variant == "narrative" else set()
        self.enc = ss_lib.Encoder(FEATS, exclude_ids=exclude)
        self.core_enc = ss_lib.Encoder([f for f in FEATS if f["id"] in CORE30])
        self.df = df
        X = self.enc.encode(df); y = (df.label == "human").astype(int).values
        self.mu = np.nanmean(X, 0); self.sd = np.nanstd(X, 0); self.keep = self.sd > 1e-6
        Z = self._z(X)
        self.y = y; self.Z = Z
        self.clf = LogisticRegression(C=C, max_iter=5000, class_weight="balanced")
        # leave-one-out estimate
        p = cross_val_predict(LogisticRegression(C=C, max_iter=5000, class_weight="balanced"), Z, y, cv=LeaveOneOut(), method="predict_proba")[:, 1]
        self.loo = {"auc": float(roc_auc_score(y, p)), "acc": float(accuracy_score(y, p >= 0.5)), "p_loo": p.tolist()}
        self.clf.fit(Z, y)
        # core-30 variant
        Xc = self.core_enc.encode(df); self.cmu = np.nanmean(Xc, 0); self.csd = np.nanstd(Xc, 0); self.ckeep = self.csd > 1e-6
        Zc = self._zc(Xc)
        pc = cross_val_predict(LogisticRegression(C=0.2, max_iter=5000, class_weight="balanced"), Zc, y, cv=LeaveOneOut(), method="predict_proba")[:, 1]
        self.loo_core = {"auc": float(roc_auc_score(y, pc)), "acc": float(accuracy_score(y, pc >= 0.5))}
        self.clf_core = LogisticRegression(C=0.2, max_iter=5000, class_weight="balanced").fit(Zc, y)
        # 2-D projection: PCA on z-space (unsupervised, so the overlays are not fitted to labels)
        self.pca = PCA(n_components=2, random_state=0).fit(Z)
        self.proj = self.pca.transform(Z)
        self.cent = {"human": Z[y == 1].mean(0), "ai": Z[y == 0].mean(0)}

    def _z(self, X):
        A = np.where(np.isnan(X), self.mu, X); return ((A - self.mu) / np.where(self.keep, self.sd, 1.0))[:, self.keep]

    def _zc(self, X):
        A = np.where(np.isnan(X), self.cmu, X); return ((A - self.cmu) / np.where(self.ckeep, self.csd, 1.0))[:, self.ckeep]

    def score(self, fd):
        X = self.enc.encode(pd.DataFrame([fd])); Z = self._z(X)
        Xc = self.core_enc.encode(pd.DataFrame([fd])); Zc = self._zc(Xc)
        d_h = float(np.linalg.norm(Z[0] - self.cent["human"])); d_a = float(np.linalg.norm(Z[0] - self.cent["ai"]))
        pr = self.pca.transform(Z)[0]
        return {"p_human_news": float(self.clf.predict_proba(Z)[0, 1]), "p_human_news_core30": float(self.clf_core.predict_proba(Zc)[0, 1]),
                "dist_human": d_h, "dist_ai": d_a, "nearest": "human" if d_h < d_a else "ai", "pc1": float(pr[0]), "pc2": float(pr[1])}

    def feature_gaps(self):
        """Per-feature human-vs-AI gap in the news corpus (encoded columns, z units), plus raw prevalence/means."""
        y = self.y; Z = self.Z; names = [c for c, k in zip(self.enc.col_names, self.keep) if k]
        gap = Z[y == 1].mean(0) - Z[y == 0].mean(0)
        out = pd.DataFrame({"col": names, "gap_z": gap}).assign(abs_gap=lambda d: d.gap_z.abs()).sort_values("abs_gap", ascending=False)
        return out


if __name__ == "__main__":
    df = load_corpus()
    print("corpus:", df.label.value_counts().to_dict(), df.model.value_counts().to_dict())
    NS = NewsSpace(df, variant="narrative")
    print("LOO narrative:", NS.loo["auc"], NS.loo["acc"], "| LOO core30:", NS.loo_core)
    g = NS.feature_gaps(); print(g.head(25).to_string())
    pickle.dump({"df": df}, open("news_corpus.pkl", "wb"))
