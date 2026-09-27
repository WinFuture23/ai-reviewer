"""Bundle the original VW article and all fact-faithful humanized candidates into one blind file with shuffled labels."""
import json, os, glob, random, sys
SS = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad"
out_md, out_key = sys.argv[1], sys.argv[2]
cands = [("original", f"{SS}/texts/vw_161566_original.txt")]
for f in sorted(glob.glob(f"{SS}/runs/*/vw_161566_original.s*.json")):
    if f.endswith(".repeat.json"):
        continue
    r = json.load(open(f))
    if r["factcheck"].get("fidelity_score", 0) >= 100:
        ver = os.path.basename(os.path.dirname(f)); cands.append((f"{ver}_s{r['sample']}", f.replace(".json", ".txt")))
random.seed(20260927); random.shuffle(cands)
key = {}
with open(out_md, "w") as fo:
    for i, (name, path) in enumerate(cands):
        lab = chr(65 + i); key[lab] = name
        fo.write(f"\n\n==================== FASSUNG {lab} ====================\n\n" + open(path).read().strip() + "\n")
json.dump(key, open(out_key, "w"), indent=1)
print(len(cands), "candidates:", key)
