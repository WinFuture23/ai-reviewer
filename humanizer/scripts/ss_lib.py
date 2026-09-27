"""StoryScope re-implementation helpers (paper-faithful encoding).

Encoding (paper §3): nominal (categorical, binary) -> one-hot, multi-select -> multi-hot,
ordinal / scale -> numeric. Missing / n/a -> NaN (numeric) or all-zero (one-hot).
"""
import json, re
import numpy as np
import pandas as pd

REPO = "/home/user/jenna-russell/storyscope"
TAXONOMY = f"{REPO}/data/taxonomy.json"
FEATURES = f"{REPO}/data/storyscope_features.parquet"

SOURCES_SORTED = ["claude", "deepseek", "gemini", "gpt", "human", "kimi"]
DISPLAY_ORDER = ["human", "claude", "gpt", "gemini", "deepseek", "kimi"]
DISPLAY_NAME = {"human": "Human", "claude": "Claude", "gpt": "GPT", "gemini": "Gemini",
                "deepseek": "DeepSeek", "kimi": "Kimi"}
# matplotlib default cycle as used in the paper's figures
COLOR = {"gpt": "tab:blue", "deepseek": "tab:orange", "gemini": "tab:green",
         "claude": "tab:red", "kimi": "tab:purple", "human": "tab:brown"}


def load_taxonomy():
    t = json.load(open(TAXONOMY))["feature_taxonomy"]
    feats = []
    for dim_key, dd in t.items():
        for asp_key, ad in dd["aspects"].items():
            for f in ad["features"]:
                feats.append({
                    "id": f["id"], "name": f["name"], "question": f["question"],
                    "type": f["type"], "values": [str(v) for v in f.get("values", [])],
                    "condition": f.get("condition"), "detection_method": f.get("detection_method", ""),
                    "dim_key": dim_key, "dim_name": dd.get("dimension_name", dim_key),
                    "dim_desc": dd.get("dimension_description", ""), "aspect": asp_key,
                })
    return feats


# ---- value normalisation (copied from storyscope/5_feature_application/apply_features.py) ----
def _normalize_str(s):
    s = str(s).strip().lower()
    s = re.sub(r'\s*\([^)]*\)', '', s)
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')
    return s


def _best_match(raw_value, allowed):
    if not allowed:
        return raw_value
    raw_norm = _normalize_str(raw_value)
    for canonical in allowed:
        if _normalize_str(canonical) == raw_norm:
            return canonical
    raw_num = re.match(r'^(\d+)', raw_norm)
    if raw_num:
        num = raw_num.group(1)
        for canonical in allowed:
            c_num = re.match(r'^(\d+)', _normalize_str(canonical))
            if c_num and c_num.group(1) == num:
                return canonical
    for canonical in allowed:
        c_norm = _normalize_str(canonical)
        if raw_norm.startswith(c_norm) or c_norm.startswith(raw_norm):
            return canonical
    raw_tokens = set(raw_norm.split('_'))
    best_score, best_canonical = 0, None
    for canonical in allowed:
        c_tokens = set(_normalize_str(canonical).split('_'))
        if not c_tokens:
            continue
        overlap = len(raw_tokens & c_tokens)
        score = overlap / max(len(raw_tokens), len(c_tokens))
        if score > best_score:
            best_score, best_canonical = score, canonical
    if best_score >= 0.5 and best_canonical is not None:
        return best_canonical
    return raw_value


def normalize_features(features, feats):
    """Raw LLM output -> canonical taxonomy values (same rules as the released code).
    Multi-select is returned as a pipe-joined string like the parquet."""
    lookup = {f["id"]: (f["type"], f["values"]) for f in feats}
    out = {}
    for fid, raw in features.items():
        if fid not in lookup:
            continue
        ftype, allowed = lookup[fid]
        if raw is None or raw == "n/a":
            out[fid] = "n/a"
        elif ftype == "multi_select":
            vals = raw if isinstance(raw, list) else [raw]
            matched = [_best_match(str(v), allowed) for v in vals]
            seen, ded = set(), []
            for m in matched:
                k = _normalize_str(m)
                if k not in seen:
                    seen.add(k); ded.append(m)
            out[fid] = "|".join(ded)
        elif ftype == "scale":
            m = re.match(r'^(\d+)', str(raw).strip())
            out[fid] = str(int(m.group(1))) if m else str(raw)
        else:
            out[fid] = _best_match(str(raw), allowed)
    return out


class Encoder:
    def __init__(self, feats, exclude_ids=()):
        self.feats = [f for f in feats if f["id"] not in set(exclude_ids)]
        self.cols = []   # (col_name, fid, kind, value)
        for f in self.feats:
            t = f["type"]
            if t in ("scale", "ordinal", "binary"):
                self.cols.append((f["id"], f["id"], t, None))
            elif t == "categorical":
                for v in f["values"]:
                    self.cols.append((f"{f['id']}__{v}", f["id"], "onehot", v))
            elif t == "multi_select":
                for v in f["values"]:
                    self.cols.append((f"{f['id']}__{v}", f["id"], "multihot", v))
        self.col_names = [c[0] for c in self.cols]
        self.fmap = {f["id"]: f for f in self.feats}

    def encode(self, df):
        n = len(df)
        X = np.full((n, len(self.cols)), np.nan, dtype=np.float32)
        cache = {}
        for j, (cn, fid, kind, val) in enumerate(self.cols):
            if fid not in cache:
                col = df[fid] if fid in df.columns else pd.Series([None] * n, index=df.index)
                cache[fid] = col.astype(object).where(col.notna(), None).tolist()
            raw = cache[fid]
            f = self.fmap[fid]
            if kind == "scale":
                X[:, j] = [self._num(r) for r in raw]
            elif kind == "ordinal":
                idx = {v: i for i, v in enumerate(f["values"])}
                X[:, j] = [idx.get(str(r), np.nan) if r not in (None, "n/a", "") else np.nan for r in raw]
            elif kind == "binary":
                X[:, j] = [1.0 if str(r) == "yes" else 0.0 if str(r) == "no" else np.nan for r in raw]
            elif kind == "onehot":
                X[:, j] = [1.0 if str(r) == val else 0.0 for r in raw]
            elif kind == "multihot":
                X[:, j] = [1.0 if (r is not None and val in str(r).split("|")) else 0.0 for r in raw]
        return X

    @staticmethod
    def _num(r):
        if r in (None, "n/a", ""):
            return np.nan
        m = re.match(r'^\s*(\d+)', str(r))
        return float(m.group(1)) if m else np.nan


def load_features_df():
    df = pd.read_parquet(FEATURES)
    return df
