"""Annotate a text with the 304 StoryScope features using the paper's per-dimension prompt
(verbatim from storyscope/5_feature_application/apply_features.py), LLM = Claude via `claude -p`.
Then score with the re-trained classifiers (ss_train.py output)."""
import json, os, pickle, subprocess, sys, time, re
from concurrent.futures import ThreadPoolExecutor
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_lib

ANNOT_MODEL = os.environ.get("SS_ANNOT_MODEL", "claude-sonnet-5")
FEATS = ss_lib.load_taxonomy()
DIMS = {}
for f in FEATS:
    DIMS.setdefault(f["dim_key"], {"name": f["dim_name"], "desc": f["dim_desc"], "features": []})["features"].append(f)


def build_dimension_prompt(dim, story_text):
    """Verbatim copy of the released build_dimension_prompt()."""
    feature_specs = []
    for f in dim["features"]:
        values_str = ", ".join(str(v) for v in f["values"][:10])
        if len(f["values"]) > 10:
            values_str += f" (+ {len(f['values']) - 10} more)"
        feature_specs.append(f"**{f['id']}** [{f['type']}]: {f['question']}")
        feature_specs.append(f"  → Values: {values_str}")
        if f.get("condition"):
            feature_specs.append(f"  → Condition: {f['condition']}")
    features_block = "\n".join(feature_specs)
    max_chars = 280000
    if len(story_text) > max_chars:
        story_text = story_text[:max_chars] + "\n\n[... story truncated ...]"
    return f"""You are a literary analyst specializing in {dim['name'].lower()}.

Extract structured features about **{dim['name']}** from the story below.
Focus area: {dim['desc']}

# FEATURES TO EXTRACT

For each feature, select the appropriate value(s) from the allowed options.

**Response format rules:**
- For "binary" features: respond with exactly "yes" or "no"
- For "categorical" features: respond with exactly ONE value from the list
- For "ordinal" features: respond with exactly ONE value from the list
- For "multi_select" features: respond with a JSON array of ALL applicable values
- For "scale" features: respond with an integer within the specified range
- ONLY use values from the provided lists
- If a feature has a condition that is not met, use "n/a"
- **Never use null or omit a key** — every feature must have a value
- If a feature is ambiguous or weakly present, pick the closest-matching value

{features_block}

# STORY TO ANALYZE

<story>
{story_text}
</story>

# OUTPUT

Return a single JSON object with feature IDs as keys.
"""


NA_ALLOWED = {"SET_LOC_013", "REV_SUR_006", "REV_SUR_009", "AGENT_ATTR_021", "PLT_CON_007", "REV_SUS_009",
              "SIT_GEN_001", "REV_SUS_003", "REV_SUS_008", "REV_DIS_002", "PLT_THM_009"}  # features with n/a in the paper's data


def build_schema(dim):
    props = {}
    for f in dim["features"]:
        vals = [str(v) for v in f["values"]] + (["n/a"] if f["id"] in NA_ALLOWED else [])
        if f["type"] == "multi_select":
            props[f["id"]] = {"type": "array", "items": {"type": "string", "enum": vals}}
        else:
            props[f["id"]] = {"type": "string", "enum": vals}
    return {"type": "object", "properties": props, "required": [f["id"] for f in dim["features"]],
            "additionalProperties": False}


def claude_call(prompt, schema=None, model=ANNOT_MODEL, timeout=900, system=None, effort=None):
    cmd = ["claude", "-p", "--model", model, "--tools", "", "--output-format", "json",
           "--no-session-persistence", "--disable-slash-commands"]
    if schema is not None:
        cmd += ["--json-schema", json.dumps(schema)]
    if system is not None:
        cmd += ["--system-prompt", system]
    if effort:
        cmd += ["--effort", effort]
    t0 = time.time()
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout,
                       cwd="/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad")
    dt = time.time() - t0
    if r.returncode != 0:
        raise RuntimeError(f"claude exit {r.returncode}: {r.stderr[-800:]} | {r.stdout[-400:]}")
    j = json.loads(r.stdout)
    j["_elapsed"] = dt
    return j


def _parse_json_obj(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    return json.loads(m.group(0)) if m else {}


def annotate_dimension(dim_key, text, model=ANNOT_MODEL, retries=2):
    dim = DIMS[dim_key]
    prompt = build_dimension_prompt(dim, text)
    schema = build_schema(dim)
    last = None
    for attempt in range(retries + 1):
        try:
            j = claude_call(prompt, schema=schema, model=model)
            obj = j.get("structured_output")
            if not isinstance(obj, dict):
                obj = _parse_json_obj(j.get("result", "") or "")
            missing = [f["id"] for f in dim["features"] if f["id"] not in obj]
            if len(missing) > len(dim["features"]) // 2:
                raise RuntimeError(f"too many missing: {len(missing)}")
            return {"dim": dim_key, "features": obj, "missing": missing, "cost": j.get("total_cost_usd"),
                    "elapsed": j["_elapsed"], "usage": j.get("usage", {})}
        except Exception as e:
            last = e
            time.sleep(3 * (attempt + 1))
    return {"dim": dim_key, "features": {}, "missing": [f["id"] for f in dim["features"]], "error": str(last)}


def annotate(text, model=ANNOT_MODEL, workers=10, log=None):
    """Full 10-dimension annotation -> (normalized feature dict, run info)."""
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda k: annotate_dimension(k, text, model=model), list(DIMS.keys())))
    raw = {}
    for r in res:
        raw.update({k: v for k, v in r["features"].items() if not k.startswith("_")})
    norm = ss_lib.normalize_features(raw, FEATS)
    info = {"model": model, "elapsed": time.time() - t0, "cost": sum((r.get("cost") or 0) for r in res),
            "n_features": len(norm), "errors": [r.get("error") for r in res if r.get("error")],
            "missing": sum(len(r["missing"]) for r in res)}
    if log:
        log(f"annotated: {info['n_features']} feats, {info['elapsed']:.0f}s, ${info['cost']:.2f}, missing={info['missing']}, errors={len(info['errors'])}")
    return norm, raw, info


class Scorer:
    def __init__(self, out_dir):
        from xgboost import XGBClassifier
        self.S = pickle.load(open(f"{out_dir}/scorer.pkl", "rb"))
        self.enc = ss_lib.Encoder(FEATS, exclude_ids=self.S["exclude"])
        assert self.enc.col_names == self.S["col_names"]
        self.clf_b = XGBClassifier(); self.clf_b.load_model(f"{out_dir}/binary.json")
        self.clf_m = XGBClassifier(); self.clf_m.load_model(f"{out_dir}/multiclass.json")
        self.Ztr = np.load(f"{out_dir}/Ztr.npy")
        self.meta = pd.read_parquet(f"{out_dir}/meta.parquet")
        self.variant = self.S["variant"]

    def _z(self, X):
        mu, sd, keep = self.S["mu"], self.S["sd"], self.S["keep"]
        A = np.where(np.isnan(X), mu, X)
        return ((A - mu) / np.where(keep, sd, 1.0))[:, keep].astype(np.float32)

    def score(self, feat_dict):
        X = self.enc.encode(pd.DataFrame([feat_dict]))
        p_h = float(self.clf_b.predict_proba(X)[0, 1])
        P = self.clf_m.predict_proba(X)[0]
        six = {s: float(P[i]) for i, s in enumerate(self.S["sources"])}
        Z = self._z(X)
        ld = self.S["lda"].transform(Z)[0]
        d = np.sqrt(((self.Ztr - Z[0]) ** 2).sum(1))
        rar = float(np.sort(d)[:25].mean())
        pct = float(np.searchsorted(self.S["rarity_train_sorted"], rar) / len(self.S["rarity_train_sorted"]))
        return {"variant": self.variant, "p_human": p_h, "pred_binary": "human" if p_h >= 0.5 else "ai",
                "six_way": six, "pred_six": max(six, key=six.get), "ld1": float(ld[0]), "ld2": float(ld[1]),
                "rarity": rar, "rarity_pct": pct,
                "n_nan_cols": int(np.isnan(X).sum())}


if __name__ == "__main__":
    # smoke: one small dimension on the VW article
    text = open(sys.argv[1]).read()
    dk = sys.argv[2] if len(sys.argv) > 2 else "perspective"
    r = annotate_dimension(dk, text)
    print(json.dumps({k: v for k, v in r.items() if k != "usage"}, indent=1, ensure_ascii=False)[:3000])
    print("usage:", r.get("usage", {}).get("input_tokens"), r.get("usage", {}).get("cache_creation_input_tokens"), r.get("usage", {}).get("output_tokens"))
