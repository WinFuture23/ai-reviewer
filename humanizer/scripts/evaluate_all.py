"""Aggregate every measurement into one table + the overlay figures.
Sources: annot2/*.json (originals & controls), runs/<version>/*.s*.json (humanized), news/annot/*.json (news corpus)."""
import json, os, sys, glob, pickle
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_annotate as A, ss_plots, news_domain as ND

SS = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad"
FIGS = f"{SS}/figs"; os.makedirs(FIGS, exist_ok=True)
DOMAIN = lambda n: "fiction" if n.startswith(("dev_", "gut_")) else "news"
LABEL = {"vw_161566_original": "VW ID. Tiguan (WinFuture 27.09.2026)", "wf_161565_gates": "Bill Gates (WinFuture 27.09.2026)",
         "wf_112000_human2019": "KI strohdoof (WinFuture 2019, human)", "dev_gemini_10367": "Gemini story 'Where All Things Perish'",
         "dev_deepseek_4557": "DeepSeek story 'The Haunted Cellar'", "dev_kimi_4582": "Kimi story 'Nobody's Story'",
         "gut_gift_of_the_magi_ohenry": "O. Henry, Gift of the Magi (human)", "gut_yellow_wallpaper_gilman": "Gilman, Yellow Wallpaper (human)",
         "gut_owl_creek_bridge_bierce": "Bierce, Owl Creek Bridge (human)", "gut_cask_of_amontillado_poe": "Poe, Cask of Amontillado (human)"}


def main(holdout_prompts=("h_112000_2019", "h_099000_2017", "h_119000_2020")):
    SN, SF = A.Scorer(f"{os.path.dirname(os.path.abspath(__file__))}/out_narrative"), A.Scorer(f"{os.path.dirname(os.path.abspath(__file__))}/out_full")
    corpus = ND.load_corpus()
    train = corpus[~corpus.name.str.split("__").str[0].isin(holdout_prompts)].reset_index(drop=True)
    test = corpus[corpus.name.str.split("__").str[0].isin(holdout_prompts)].reset_index(drop=True)
    NS = ND.NewsSpace(train, variant="narrative")
    news_info = {"n_train": int(len(train)), "n_test": int(len(test)), "loo_narrative": {k: v for k, v in NS.loo.items() if k != "p_loo"}, "loo_core30": NS.loo_core,
                 "holdout": [{"name": r["name"], "label": r.label, **{k: v for k, v in NS.score(r.to_dict()).items() if k in ("p_human_news", "p_human_news_core30", "nearest")}} for _, r in test.iterrows()]}
    fcols = [c for c in corpus.columns if c not in ("name", "label", "model")]
    rows = []

    def add(name, version, sample, fd, fc=None, words=None, run=1):
        sn, sf = SN.score(fd), SF.score(fd)
        ns = NS.score(fd)
        rows.append({"text": name, "label": LABEL.get(name, name), "domain": DOMAIN(name), "version": version, "sample": sample, "run": run,
                     "p_human_narr": sn["p_human"], "p_human_full": sf["p_human"], "six_narr": sn["pred_six"], "six_narr_p": max(sn["six_way"].values()),
                     "six_full": sf["pred_six"], "ld1": sn["ld1"], "ld2": sn["ld2"], "p_human_news": ns["p_human_news"], "p_human_news_core30": ns["p_human_news_core30"],
                     "news_nearest": ns["nearest"], "pc1": ns["pc1"], "pc2": ns["pc2"], "fidelity": (fc or {}).get("fidelity_score"),
                     "invented": len((fc or {}).get("invented_facts", [])) if fc else None, "altered": len((fc or {}).get("altered_facts", [])) if fc else None,
                     "dropped": len((fc or {}).get("dropped_facts", [])) if fc else None, "words": words, "six_way": sn["six_way"]})

    feats = {}
    for f in sorted(glob.glob(f"{SS}/annot2/*.json")):
        r = json.load(open(f)); add(r["name"], "original", 0, r["features"], words=None, run=r["run"]); feats[(r["name"], "original", 0)] = r["features"]
    for f in sorted(glob.glob(f"{SS}/runs/*/*.s*.json")):
        if f.endswith(".repeat.json"):
            continue
        r = json.load(open(f)); ver = os.path.basename(os.path.dirname(f))
        anns = list(r["annotations"])
        rep = f.replace(".json", ".repeat.json")
        if os.path.exists(rep):
            anns += [{"run": 100 + x["run"], "features": x["features"]} for x in json.load(open(rep))]
        for a in anns:
            add(r["name"], ver, r["sample"], a["features"], r["factcheck"], r["words_rew"], a["run"]); feats[(r["name"], ver, r["sample"])] = anns[0]["features"]
    # news mirror texts humanized (names contain '__')
    df = pd.DataFrame(rows)
    df.to_csv(f"{SS}/results_table.csv", index=False)
    summ = df.groupby(["text", "label", "domain", "version", "sample"], as_index=False).agg(
        n_annot=("run", "count"), p_human_narr_mean=("p_human_narr", "mean"), p_human_narr_min=("p_human_narr", "min"), p_human_narr_max=("p_human_narr", "max"),
        p_human_full_mean=("p_human_full", "mean"), fidelity=("fidelity", "first"), invented=("invented", "first"), words=("words", "first"))
    summ["verdict"] = np.where(summ.p_human_narr_mean >= 0.5, "human", "ai")
    summ.to_csv(f"{SS}/results_summary.csv", index=False)
    json.dump({"news_space": news_info, "rows": rows}, open(f"{SS}/results_all.json", "w"), indent=1, ensure_ascii=False, default=float)
    return df, NS, feats, news_info, summ


if __name__ == "__main__":
    df, NS, feats, info, summ = main()
    pd.set_option("display.width", 250); pd.set_option("display.max_rows", 200)
    print("NEWS SPACE:", json.dumps(info, indent=1)[:1500])
    cols = ["text", "version", "sample", "run", "p_human_narr", "p_human_full", "six_narr", "p_human_news", "p_human_news_core30", "news_nearest", "fidelity", "invented", "words"]
    print(df[cols].round(3).to_string())
    print("\nSUMMARY (mean over annotation runs):")
    print(summ.round(3).to_string())


def make_figures(df, NS, feats, best_version):
    """Overlay figures: LDA (fiction texts), news space (news texts), core profiles."""
    import matplotlib.colors as mc
    out = {}
    # --- LDA overlays: fiction originals -> humanized (best version, sample 1)
    ov = []
    fict = [t for t in df.text.unique() if t.startswith("dev_")]
    gut = [t for t in df.text.unique() if t.startswith("gut_")]
    for t in fict:
        o = df[(df.text == t) & (df.version == "original")].iloc[0]
        h = df[(df.text == t) & (df.version == best_version)]
        code = {"dev_gemini_10367": "G", "dev_deepseek_4557": "D", "dev_kimi_4582": "K"}[t]
        ov.append({"code": code, "label": LABEL[t] + " (original)", "ld1": o.ld1, "ld2": o.ld2, "marker": "o", "color": "#111111", "size": 130})
        if len(h):
            hh = h.iloc[0]
            ov.append({"code": code + "'", "label": f"dieselbe Story humanisiert ({best_version})", "ld1": hh.ld1, "ld2": hh.ld2, "marker": "o", "color": "#d62728", "size": 130, "arrow_from": (o.ld1, o.ld2)})
    for i, t in enumerate(gut):
        o = df[(df.text == t) & (df.version == "original")].iloc[0]
        ov.append({"code": f"H{i+1}", "label": LABEL[t].replace(" (human)", ", gemeinfrei (Mensch)"), "ld1": o.ld1, "ld2": o.ld2, "marker": "o", "color": "#2a78d6", "size": 130})
    D = ss_plots.load(f"{os.path.dirname(os.path.abspath(__file__))}/out_narrative")
    out["lda"] = ss_plots.fig_lda(D, overlays=ov, out=f"{FIGS}/fig2_lda_overlay_fiction.png", title="Fig. 2 nachgebaut: Story-Kontrollen und humanisierte Stories im narrativen Merkmalsraum")
    # --- news space overlays
    ov2 = []
    for t, col in (("vw_161566_original", "#111111"), ("wf_161565_gates", "#555555"), ("wf_112000_human2019", "#2a78d6")):
        rows = df[(df.text == t) & (df.version == "original")]
        if not len(rows):
            continue
        o = rows.iloc[0]
        ov2.append({"label": LABEL[t] + " (orig.)", "pc1": o.pc1, "pc2": o.pc2, "marker": "*" if t != "wf_112000_human2019" else "P", "color": col, "offset": (10, -14) if t != "wf_112000_human2019" else (10, 12)})
        h = df[(df.text == t) & (df.version == best_version)]
        for k, (_, hh) in enumerate(h.iterrows()):
            ov2.append({"label": f"→ humanisiert ({best_version}, s{int(hh['sample'])})", "pc1": hh.pc1, "pc2": hh.pc2, "marker": "*", "color": "#d62728", "arrow_from": (o.pc1, o.pc2), "offset": (10, -16 - 12 * k)})
    out["news"] = ss_plots.fig_news_space(NS, ov2, out=f"{FIGS}/fig_news_space.png", title="Paper-Methode auf WinFuture-News: menschliche Artikel 2017–2020 vs. KI-Spiegelartikel")
    # --- core profiles
    key_vw = [k for k in feats if k[0] == "vw_161566_original" and k[1] == best_version]
    texts = [("VW-Artikel Original", feats[("vw_161566_original", "original", 0)], "#111111", "*")]
    if key_vw:
        texts.append((f"VW-Artikel humanisiert ({best_version})", feats[key_vw[0]], "#d62728", "*"))
    out["core_vw"] = ss_plots.fig_core_profile(texts, out=f"{FIGS}/fig_core_profile_vw.png", title="Table-16-Profil: VW-Artikel vor/nach Humanisierung")
    key_k = [k for k in feats if k[0] == "dev_kimi_4582" and k[1] == best_version]
    texts = [("Kimi-Story Original", feats[("dev_kimi_4582", "original", 0)], "#111111", "D")]
    if key_k:
        texts.append((f"Kimi-Story humanisiert ({best_version})", feats[key_k[0]], "#d62728", "D"))
    out["core_kimi"] = ss_plots.fig_core_profile(texts, out=f"{FIGS}/fig_core_profile_kimi.png", title="Table-16-Profil: Kimi-Story vor/nach Humanisierung")
    return out
