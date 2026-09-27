import json, sys, os, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_annotate as A
T = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad/texts"
OUT = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad/annot2"
os.makedirs(OUT, exist_ok=True)
jobs = [("vw_161566_original", 1), ("vw_161566_original", 2), ("vw_161566_original", 3),
        ("wf_112000_human2019", 1), ("wf_161565_gates", 1),
        ("dev_gemini_10367", 1), ("dev_deepseek_4557", 1), ("dev_kimi_4582", 1)]
def run(job):
    name, run_id = job
    fn = f"{OUT}/{name}.run{run_id}.json"
    if os.path.exists(fn):
        return fn
    text = open(f"{T}/{name}.txt").read()
    norm, raw, info = A.annotate(text, workers=10)
    json.dump({"name": name, "run": run_id, "features": norm, "raw": raw, "info": info}, open(fn, "w"), indent=1, ensure_ascii=False)
    print(time.strftime("%H:%M:%S"), name, run_id, info, flush=True)
    return fn
with ThreadPoolExecutor(max_workers=2) as ex:
    list(ex.map(run, jobs))
print("ALL DONE")
