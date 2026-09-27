"""Rewrite a text with a humanization prompt, fact-check it, annotate and score it.
Usage: python3 ss_humanize.py <prompt.md> <text.txt> <run_dir> [--rewriter MODEL] [--samples N] [--variant out_dir]"""
import argparse, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_annotate as A

FACTCHECK_SCHEMA = {
    "type": "object",
    "properties": {
        "invented_facts": {"type": "array", "items": {"type": "string"}, "description": "claims/numbers/names/quotes/sources in the REWRITE that are not in the ORIGINAL"},
        "altered_facts": {"type": "array", "items": {"type": "string"}, "description": "facts whose meaning, number, date, attribution changed"},
        "dropped_facts": {"type": "array", "items": {"type": "string"}, "description": "facts of the ORIGINAL missing in the REWRITE"},
        "language_and_genre_preserved": {"type": "boolean"},
        "fidelity_score": {"type": "integer", "minimum": 0, "maximum": 100},
    },
    "required": ["invented_facts", "altered_facts", "dropped_facts", "language_and_genre_preserved", "fidelity_score"],
}
FACTCHECK_PROMPT = """You are a meticulous fact-checker in a newsroom. Compare the REWRITE against the ORIGINAL.
List every factual claim, number, date, name, quotation, product detail or source attribution in the REWRITE that does NOT appear in the ORIGINAL (invented_facts).
List every fact whose content changed (altered_facts) and every fact of the ORIGINAL that the REWRITE dropped (dropped_facts).
Reordering, reframing, changed emphasis, changed wording, added reader address, added hedges like "so viel steht fest", generic transitional remarks and removed evaluative commentary are NOT facts and must not be listed.
For a fictional story, "facts" are ONLY plot events, characters, names, places and outcomes. Invented = new plot events, new characters, new places or a changed outcome; NOT new wording, not new small sensory or dialogue details that leave the plot intact, not a scene told from a different moment in time. Dropped/altered = a plot event, character or outcome that is missing or changed; NOT a removed or reworded moral, lesson, interpretation, thematic statement, narrator commentary, epilogue reflection or description of a feeling (removing those is an intended editorial change, never list it).
fidelity_score: 100 = nothing invented, altered or dropped; subtract 15 per invented fact, 10 per altered fact, 5 per dropped fact (floor 0).

<original>
{orig}
</original>

<rewrite>
{rew}
</rewrite>
"""


def rewrite(prompt_md, text, model, effort="high"):
    user = f"{prompt_md}\n\n# Eingabetext\n\n<text>\n{text}\n</text>\n"
    j = A.claude_call(user, model=model, effort=effort, timeout=1200)
    return j.get("result", "").strip(), j


def factcheck(orig, rew, model="claude-opus-5-5"):
    j = A.claude_call(FACTCHECK_PROMPT.format(orig=orig, rew=rew), schema=FACTCHECK_SCHEMA, model=model, timeout=900)
    return j.get("structured_output") or {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt"); ap.add_argument("text"); ap.add_argument("run_dir")
    ap.add_argument("--rewriter", default="claude-opus-5-5")
    ap.add_argument("--samples", type=int, default=1)
    ap.add_argument("--variants", default="out_narrative,out_full")
    ap.add_argument("--annot-runs", type=int, default=1)
    args = ap.parse_args()
    os.makedirs(args.run_dir, exist_ok=True)
    prompt_md = open(args.prompt).read(); text = open(args.text).read()
    name = os.path.basename(args.text).replace(".txt", "")
    base = os.path.dirname(os.path.abspath(__file__))
    scorers = [A.Scorer(f"{base}/{v}") for v in args.variants.split(",") if os.path.exists(f"{base}/{v}/scorer.pkl")]

    def one(k):
        out_fn = f"{args.run_dir}/{name}.s{k}.json"
        if os.path.exists(out_fn):
            return json.load(open(out_fn))
        t0 = time.time()
        rew, j = rewrite(prompt_md, text, args.rewriter)
        open(f"{args.run_dir}/{name}.s{k}.txt", "w").write(rew)
        fc = factcheck(text, rew)
        rec = {"name": name, "sample": k, "prompt": os.path.basename(args.prompt), "rewriter": args.rewriter,
               "words_orig": len(text.split()), "words_rew": len(rew.split()), "rewrite_cost": j.get("total_cost_usd"),
               "factcheck": fc, "annotations": []}
        for r in range(args.annot_runs):
            norm, raw, info = A.annotate(rew, workers=10)
            scores = {s.variant: s.score(norm) for s in scorers}
            rec["annotations"].append({"run": r + 1, "features": norm, "info": info, "scores": scores})
        rec["elapsed"] = time.time() - t0
        json.dump(rec, open(out_fn, "w"), indent=1, ensure_ascii=False)
        sc = rec["annotations"][0]["scores"]
        print(time.strftime("%H:%M:%S"), name, f"s{k}", {v: (round(s["p_human"], 3), s["pred_six"]) for v, s in sc.items()},
              "fidelity", fc.get("fidelity_score"), "inv", len(fc.get("invented_facts", [])), "words", rec["words_rew"], flush=True)
        return rec

    with ThreadPoolExecutor(max_workers=args.samples) as ex:
        list(ex.map(one, range(1, args.samples + 1)))


if __name__ == "__main__":
    main()
