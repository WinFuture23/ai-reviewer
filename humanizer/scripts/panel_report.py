"""Format the blind reader panel output (workflow result JSON) into markdown using the label key."""
import json, sys
res = json.load(open(sys.argv[1])); key = json.load(open(sys.argv[2]))
if "result" in res:
    res = res["result"]
name = {"original": "Original (WinFuture, 27.09.2026)", "final_s2": "Final-Prompt, Probe 2 (Gewinner)"}
rows = ["| Fassung (blind) | ist | Gesamt | Lesbarkeit | Fluss/Reihenfolge | Natürlichkeit | Vertrauen/Klarheit | Platz 1 (von 5) |", "|---|---|---|---|---|---|---|---|"]
for t in res["table"]:
    lab = t["label"]; n = key.get(lab, "?")
    rows.append("| %s | %s | **%.2f** | %.2f | %.2f | %.2f | %.2f | %d |" % (lab, name.get(n, n.replace("_s", ", Probe ")), t["overall"], t["readability"], t["flow"], t["natural"], t["trust"], t["firsts"]))
out = ["\n".join(rows), ""]
for i, r in enumerate(res["readers"], 1):
    top3 = " > ".join("%s (%s)" % (l, key.get(l, l)) for l in r["ranking"][:3])
    out.append("- Leser %d: Top 3 %s. Wie von einem Menschen: %s" % (i, top3, r["which_reads_like_a_human_journalist"][:280]))
    out.append("  Schwächen der besten Fassung: " + " | ".join(w[:160] for w in r["weaknesses_of_best"][:3]))
print("\n".join(out))
