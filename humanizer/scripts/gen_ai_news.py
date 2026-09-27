"""Build the AI half of the news mini-corpus, following the paper's mirror design:
1) reverse-engineer a writing brief from each human article (Figure 6 analogue for news),
2) let several LLMs write a WinFuture-style article from that brief with the same target length."""
import json, os, sys, glob, time, re
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_annotate as A
H = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad/news/human"
OUT = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad/news/ai"
BR = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad/news/briefs"
os.makedirs(OUT, exist_ok=True); os.makedirs(BR, exist_ok=True)
MODELS = ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"]

BRIEF_PROMPT = """You are a news editor preparing a writing brief for a reporter. Read the German tech-news article below and produce ONE brief (in German) that a reporter could write the article from without having read it:
1. Thema in einem Satz.
2. Alle Fakten als Stichpunktliste: Namen, Firmen, Produkte, Zahlen, Daten, Preise, Orte, Quellen (Medien, Webseiten, Personen) und wörtliche Zitate (mit Sprecher) – vollständig, nichts weglassen, nichts hinzufügen.
3. Anlass / Nachrichtenwert in einem Satz.
Do NOT describe the article's structure, order, tone, wording, headline or subheadings. Do not copy sentences. Output only the brief.

<article>
{art}
</article>"""

WRITE_PROMPT = """Du bist Redakteur:in bei WinFuture.de, einem deutschen Technik-Nachrichtenportal. Schreibe aus dem folgenden Briefing eine vollständige News: Überschrift, dann ein Teaser-Absatz, dann der Artikeltext mit Zwischenüberschriften, wie es bei WinFuture üblich ist. Verwende ausschließlich die Fakten aus dem Briefing, erfinde nichts dazu. Länge: ungefähr {n} Wörter. Gib nur den Artikel aus (reiner Text, keine Markdown-Zeichen, keine Anmerkungen).

<briefing>
{brief}
</briefing>"""

def brief_for(path):
    name = os.path.basename(path).replace(".txt", "")
    fn = f"{BR}/{name}.brief.txt"
    if os.path.exists(fn):
        return name, open(fn).read()
    art = open(path).read()
    j = A.claude_call(BRIEF_PROMPT.format(art=art), model="claude-sonnet-5", effort="medium")
    open(fn, "w").write(j["result"].strip())
    return name, j["result"].strip()

def write_for(args):
    name, brief, model, n_words = args
    tag = model.split("-")[1]
    fn = f"{OUT}/{name}__{tag}.txt"
    if os.path.exists(fn):
        return fn
    j = A.claude_call(WRITE_PROMPT.format(brief=brief, n=n_words), model=model, effort="medium")
    txt = j["result"].strip()
    txt = re.sub(r"^#+\s*", "", txt, flags=re.M).replace("**", "")
    open(fn, "w").write(txt)
    print(time.strftime("%H:%M:%S"), fn, len(txt.split()), "words", flush=True)
    return fn

humans = sorted(glob.glob(f"{H}/h_*.txt"))
with ThreadPoolExecutor(max_workers=6) as ex:
    briefs = dict(ex.map(brief_for, humans))
print("briefs:", len(briefs), flush=True)
jobs = []
for i, path in enumerate(humans):
    name = os.path.basename(path).replace(".txt", "")
    n_words = len(open(path).read().split())
    # two models per human article, rotating so each model writes ~2/3 of the prompts
    for m in (MODELS[i % 3], MODELS[(i + 1) % 3]):
        jobs.append((name, briefs[name], m, n_words))
with ThreadPoolExecutor(max_workers=6) as ex:
    list(ex.map(write_for, jobs))
print("ALL DONE", len(jobs))
