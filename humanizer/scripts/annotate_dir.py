"""Annotate every *.txt in a directory (or explicit file list) -> OUT/<name>.run1.json"""
import json, sys, os, time, glob
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_annotate as A
src, out, par = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 2
os.makedirs(out, exist_ok=True)
files = sorted(glob.glob(f"{src}/*.txt")) if os.path.isdir(src) else src.split(",")
def run(fn):
    name = os.path.basename(fn).replace(".txt", "")
    o = f"{out}/{name}.run1.json"
    if os.path.exists(o):
        return
    text = open(fn).read()
    norm, raw, info = A.annotate(text, workers=10)
    json.dump({"name": name, "run": 1, "features": norm, "raw": raw, "info": info}, open(o, "w"), indent=1, ensure_ascii=False)
    print(time.strftime("%H:%M:%S"), name, f"{info['elapsed']:.0f}s ${info['cost']:.2f} missing={info['missing']} err={len(info['errors'])}", flush=True)
with ThreadPoolExecutor(max_workers=par) as ex:
    list(ex.map(run, files))
print("ALL DONE")
