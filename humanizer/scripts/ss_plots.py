"""Paper-style figures (Fig. 2 LDA projection, Fig. 3 confusion matrix, Fig. 5 rarity violins)
from the re-trained StoryScope models, with optional overlays for newly scored texts."""
import json, os, sys, pickle
import numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ss_lib

ORDER = ["human", "claude", "gpt", "gemini", "deepseek", "kimi"]
NAME = {"human": "Human", "claude": "Claude", "gpt": "GPT", "gemini": "Gemini", "deepseek": "DeepSeek", "kimi": "Kimi"}
# validated reference palette, slots 1-6 in fixed order (dataviz skill, references/palette.md)
COL = {"human": "#2a78d6", "claude": "#eb6834", "gpt": "#1baf7a", "gemini": "#eda100", "deepseek": "#e87ba4", "kimi": "#008300"}
LBL_OFF = {"human": (8, 6), "claude": (8, 6), "gpt": (8, 6), "kimi": (-58, 22), "deepseek": (14, -30), "gemini": (30, -6)}
MK = {"human": "o", "claude": "s", "gpt": "^", "gemini": "D", "deepseek": "v", "kimi": "P"}
TXT1, TXT2, GRID = "#0b0b0b", "#52514e", "#e6e5e1"

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": "#b5b4ae", "axes.labelcolor": TXT1,
                     "xtick.color": TXT2, "ytick.color": TXT2, "axes.titleweight": "normal", "figure.facecolor": "white"})


def _style(ax):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.grid(True, color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def load(out_dir):
    meta = pd.read_parquet(f"{out_dir}/meta.parquet")
    te = np.load(f"{out_dir}/test_idx.npy")
    S = pickle.load(open(f"{out_dir}/scorer.pkl", "rb"))
    return {"src_te": meta.source.values[te], "lda_te": np.load(f"{out_dir}/lda_test.npy"),
            "rar_te": np.load(f"{out_dir}/rarity_test_pct.npy"), "metrics": json.load(open(f"{out_dir}/metrics.json")), "S": S}


def fig_lda(D, overlays=None, out="fig2_lda.png", title=None, per_source=600, seed=0):
    """overlays: list of dicts {code, label, ld1, ld2, marker, color, arrow_from}. Points carry a short code;
    the code -> label mapping is printed in a caption column at the right so labels never collide."""
    rng = np.random.default_rng(seed)
    fig = plt.figure(figsize=(10.4, 4.9), dpi=170)
    gs = fig.add_gridspec(1, 2, width_ratios=[3.1, 1.25], wspace=0.04)
    ax = fig.add_subplot(gs[0]); cap = fig.add_subplot(gs[1]); cap.axis("off")
    _style(ax)
    for s in ORDER:
        idx = np.where(D["src_te"] == s)[0]
        pick = rng.choice(idx, size=min(per_source, len(idx)), replace=False)
        ax.scatter(D["lda_te"][pick, 0], D["lda_te"][pick, 1], s=7, c=COL[s], marker=MK[s], alpha=0.35, linewidths=0, label=NAME[s])
    for s in ORDER:
        c = D["lda_te"][D["src_te"] == s].mean(0)
        ax.scatter([c[0]], [c[1]], s=110, c=COL[s], marker="D", edgecolors="white", linewidths=1.6, zorder=5)
        ax.annotate(NAME[s], (c[0], c[1]), xytext=LBL_OFF.get(s, (7, 6)), textcoords="offset points", fontsize=8.5, color=TXT1, weight="bold", zorder=6,
                    arrowprops=dict(arrowstyle="-", color="#777777", lw=0.6) if s in ("kimi", "deepseek", "gemini") else None)
    lines = []
    if overlays:
        for o in overlays:
            if o.get("arrow_from") is not None:
                ax.annotate("", xy=(o["ld1"], o["ld2"]), xytext=o["arrow_from"],
                            arrowprops=dict(arrowstyle="-|>", color="#333333", lw=1.0, shrinkA=7, shrinkB=7), zorder=7)
            ax.scatter([o["ld1"]], [o["ld2"]], s=o.get("size", 150), marker=o.get("marker", "*"), c=o.get("color", "#111111"),
                       edgecolors="white", linewidths=1.2, zorder=8)
            ax.annotate(o["code"], (o["ld1"], o["ld2"]), xytext=(0, 0), textcoords="offset points", fontsize=6.5, color="white",
                        ha="center", va="center", weight="bold", zorder=9)
            lines.append((o["code"], o["label"], o.get("color", "#111111"), o.get("marker", "*")))
    ax.set_xlabel("LD1"); ax.set_ylabel("LD2")
    if title:
        ax.set_title(title, loc="left", fontsize=10, color=TXT1)
    handles = [Line2D([0], [0], marker=MK[s], color="none", markerfacecolor=COL[s], markersize=6, label=NAME[s]) for s in ORDER]
    handles.append(Line2D([0], [0], marker="D", color="none", markerfacecolor="#8a8983", markersize=7, label="source centroid"))
    ax.legend(handles=handles, loc="lower left", frameon=True, framealpha=0.9, edgecolor="none", fontsize=7.5, ncol=2, title="test split (paper data)", title_fontsize=7.5)
    if lines:
        cap.text(0.0, 0.98, "Scored texts (Claude-annotated)", fontsize=8.5, weight="bold", va="top", color=TXT1, transform=cap.transAxes)
        y = 0.90
        for code, label, col, mk in lines:
            cap.scatter([0.04], [y], s=120, marker=mk, c=col, edgecolors="white", linewidths=1.0, transform=cap.transAxes, clip_on=False)
            cap.text(0.04, y, code, fontsize=6.5, color="white", ha="center", va="center", weight="bold", transform=cap.transAxes)
            cap.text(0.11, y, label, fontsize=7.6, va="center", color=TXT1, transform=cap.transAxes, wrap=True)
            y -= 0.062
    fig.savefig(out, bbox_inches="tight"); plt.close(fig)
    return out


def fig_confusion(D, out="fig3_confusion.png", title=None):
    cm = np.array(D["metrics"]["confusion_rows_actual_sorted"], dtype=float)  # rows/cols in SOURCES_SORTED order
    srt = ss_lib.SOURCES_SORTED
    perm = [srt.index(s) for s in ORDER]
    cm = cm[np.ix_(perm, perm)]
    pct = 100 * cm / cm.sum(1, keepdims=True)
    fig, ax = plt.subplots(figsize=(5.2, 4.3), dpi=170)
    off = pct.copy(); np.fill_diagonal(off, np.nan)
    im = ax.imshow(np.nan_to_num(off, nan=0), cmap="Blues", vmin=0, vmax=max(2, np.nanmax(off)))
    for i in range(6):
        for j in range(6):
            v = pct[i, j]
            dark = (i != j and v > 0.6 * np.nanmax(off))
            ax.text(j, i, f"{v:.1f}", ha="center", va="center", fontsize=8, color="white" if dark else TXT1, weight="bold" if i == j else "normal")
        ax.add_patch(plt.Rectangle((i - 0.5, i - 0.5), 1, 1, fill=True, color="#f1f0ec", zorder=0.5))
    ax.set_xticks(range(6)); ax.set_xticklabels([NAME[s] for s in ORDER], rotation=30, ha="right")
    ax.set_yticks(range(6)); ax.set_yticklabels([NAME[s] for s in ORDER])
    ax.set_xlabel("Predicted"); ax.set_ylabel("Actual")
    for s in ax.spines.values():
        s.set_visible(False)
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03); cb.set_label("Row % (off-diagonal)", color=TXT2); cb.outline.set_visible(False)
    if title:
        ax.set_title(title, loc="left", fontsize=10, color=TXT1)
    fig.tight_layout(); fig.savefig(out); plt.close(fig)
    return out


def fig_rarity(D, out="fig5_rarity.png", title=None, marks=None):
    fig, ax = plt.subplots(figsize=(8.0, 3.9), dpi=170)
    _style(ax)
    data = [D["rar_te"][D["src_te"] == s] for s in ORDER]
    parts = ax.violinplot(data, positions=range(6), showmeans=False, showmedians=False, showextrema=False, widths=0.8)
    for body, s in zip(parts["bodies"], ORDER):
        body.set_facecolor(COL[s]); body.set_edgecolor("none"); body.set_alpha(0.75)
    for i, d in enumerate(data):
        ax.hlines(d.mean(), i - 0.16, i + 0.16, colors=TXT1, linewidths=1.6)
        ax.hlines(np.median(d), i - 0.16, i + 0.16, colors=TXT1, linewidths=1.2, linestyles=(0, (2, 2)))
        ax.annotate(f"Ø {d.mean():.2f}", (i, 1.02), ha="center", fontsize=7.5, color=TXT2, annotation_clip=False)
    ax.axhline(0.5, color=GRID, linewidth=1.0, zorder=0)
    ax.set_xticks(range(6)); ax.set_xticklabels([NAME[s] for s in ORDER])
    ax.set_ylabel("Rarity percentile (vs. train)"); ax.set_ylim(-0.02, 1.08)
    handles = [Line2D([0], [0], color=TXT1, lw=1.6, label="mean"), Line2D([0], [0], color=TXT1, lw=1.2, ls=(0, (2, 2)), label="median")]
    if marks:
        for m in marks:
            ax.axhline(m["y"], color="#111111", lw=0.8, ls=":"); ax.annotate(m["label"], (5.45, m["y"]), fontsize=7.5, va="center", color=TXT1)
    ax.legend(handles=handles, loc="lower left", frameon=False, fontsize=8)
    if title:
        ax.set_title(title, loc="left", fontsize=10, color=TXT1)
    fig.tight_layout(); fig.savefig(out); plt.close(fig)
    return out


if __name__ == "__main__":
    D = load("out_narrative")
    F = "/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad/figs"
    print(fig_lda(D, out=f"{F}/fig2_lda_repro.png", title="Narrative feature space (257 features), LDA projection of the held-out test split"))
    print(fig_confusion(D, out=f"{F}/fig3_confusion_repro.png", title="Six-way attribution, narrative model (row %)"))
    print(fig_rarity(D, out=f"{F}/fig5_rarity_repro.png", title="Per-story narrative rarity by source (test split)"))
    print({s: D["lda_te"][D["src_te"] == s].mean(0).round(2).tolist() for s in ORDER})


# ---------------------------------------------------------------------------
# Table-16 core-feature profile (dumbbell: human mean <-> AI mean, with scored texts)
# ---------------------------------------------------------------------------
CORE = [  # (feature id, label, kind, human, ai, option)  kind: scale/ord (mean) or opt (prevalence of option)
    ("SIT_MET_303", "Thematic explicitness & moralizing", "scale", 3.28, 3.94, None),
    ("SIT_GEN_010", "Moral / philosophical weighting", "scale", 3.26, 3.68, None),
    ("PLT_THM_008", "Thematic unity", "scale", 4.41, 4.74, None),
    ("SIT_MET_501", "Narratorial thematic commentary = yes", "opt", .52, .77, "yes"),
    ("PER_DIA_003", "Dialogue function: philosophical debate", "opt", .34, .59, "philosophical_or_thematic_debate"),
    ("SIT_MET_008", "References: implicit echoes", "opt", .50, .72, "Primarily implicit echoes (genres, archetypes, unnamed myths)"),
    ("AGENT_EMO_009", "Emotion expressed: embodied", "opt", .38, .81, "embodied_sensations_and_metaphors"),
    ("SET_ATM_022", "Setting as psychological mirror", "scale", 3.58, 4.07, None),
    ("SET_LOC_014", "Environmental / ecological emphasis", "scale", 2.83, 3.21, None),
    ("SET_ATM_017", "Sensory modality: olfactory", "opt", .57, .82, "olfactory"),
    ("SET_ATM_005", "Sensory density", "scale", 3.66, 3.93, None),
    ("PER_FOC_001", "Depth of interior access", "scale", 3.67, 3.93, None),
    ("EVT_CAU_002", "Causal chain continuity", "scale", 3.92, 4.20, None),
    ("SET_LOC_002", "Spatial granularity", "ord", 2.27, 2.53, None),
    ("PLT_CON_007", "Resolution by protagonist choice", "opt", .46, .69, "primarily_protagonist_choice"),
    ("AGENT_ATTR_001", "Character intro: external description", "opt", .30, .52, "external description (appearance/background summary)"),
    ("PLT_THM_009", "No subplots", "opt", .57, .79, "no_subplots"),
    ("EVT_SCH_004", "Resolution: internal understanding", "opt", .27, .47, "resolved_through_internal_understanding_or_acceptance"),
    ("SET_LOC_004", "Opening spatial grounding", "ord", 2.12, 2.33, None),
    ("REV_SUS_007", "Pre-threat character investment", "scale", 2.76, 2.99, None),
    ("SIT_MET_202", "Explicit named reference", "opt", .47, .24, "explicit_named_reference_to_specific_texts_or_authors"),
    ("SIT_MET_004", "Fourth-wall permeability", "ord", 0.67, 0.39, None),
    ("PER_POV_009", "Direct reader address", "ord", 0.28, 0.07, None),
    ("REV_SUR_003", "Recontextualization after surprise", "scale", 3.28, 2.95, None),
    ("TMP_ORD_010", "Chronological discontinuity", "scale", 2.40, 2.12, None),
    ("REV_DIS_003", "Nonlinear framing for delayed disclosure", "scale", 1.96, 1.68, None),
    ("TMP_ORD_002", "Anachrony intensity", "scale", 2.58, 2.31, None),
    ("SET_LOC_011", "Location variety", "ord", 1.34, 1.08, None),
    ("PER_DIA_001", "Dialogue-to-narration proportion", "scale", 2.95, 2.70, None),
    ("PLT_MOR_002", "Moral polarity: ambivalent", "opt", .59, .38, "ambivalent_or_morally_mixed"),
]
_FM = {f["id"]: f for f in ss_lib.load_taxonomy()}


def core_value(fd, fid, kind, option):
    """Map a text's feature value onto the Table-16 axis (mean scale or 0/1 option)."""
    v = fd.get(fid)
    if v in (None, "n/a", ""):
        return np.nan
    f = _FM[fid]
    if kind == "opt":
        return 1.0 if option in str(v).split("|") else 0.0
    if kind == "scale":
        import re
        m = re.match(r"^\s*(\d+)", str(v)); return float(m.group(1)) if m else np.nan
    if kind == "ord":
        vals = f["values"]
        if fid in ("SIT_MET_004", "PER_POV_009"):   # paper reports these as 0-based ordinal means
            return float(vals.index(str(v))) if str(v) in vals else np.nan
        return float(vals.index(str(v)) + 1) if str(v) in vals else np.nan
    return np.nan


def fig_core_profile(texts, out="fig_core_profile.png", title=None):
    """texts: list of (label, feature_dict, color, marker). Values normalised per feature to the human..AI span."""
    fig, ax = plt.subplots(figsize=(8.6, 9.2), dpi=170)
    _style(ax); ax.grid(True, axis="x", color=GRID); ax.grid(False, axis="y")
    ys = np.arange(len(CORE))[::-1]
    for y, (fid, lab, kind, h, a, opt) in zip(ys, CORE):
        lo, hi = (0, 1) if kind == "opt" else ((1, 5) if kind == "scale" else (0, 4) if fid in ("SIT_MET_004", "PER_POV_009") else (1, 5))
        nh, na = (h - lo) / (hi - lo), (a - lo) / (hi - lo)
        ax.plot([nh, na], [y, y], color="#c9c8c2", lw=2.2, solid_capstyle="round", zorder=1)
        ax.scatter([nh], [y], s=42, c=COL["human"], marker="o", zorder=3, edgecolors="white", linewidths=0.8)
        ax.scatter([na], [y], s=42, c="#8a8983", marker="o", zorder=3, edgecolors="white", linewidths=0.8)
        for k, (tl, fd, col, mk) in enumerate(texts):
            v = core_value(fd, fid, kind, opt)
            if not np.isnan(v):
                nv = (v - lo) / (hi - lo)
                ax.scatter([nv], [y + 0.0], s=70, c=col, marker=mk, zorder=4, edgecolors="white", linewidths=0.8)
    ax.set_yticks(ys); ax.set_yticklabels([c[1] for c in CORE], fontsize=8)
    ax.set_xlim(-0.03, 1.03); ax.set_xlabel("position on the feature's range (0 = lowest option / absent, 1 = highest / present)")
    ax.axhspan(len(CORE) - 20.5, len(CORE) + 0.5, color="#f6f5f1", zorder=0)
    ax.text(1.02, len(CORE) - 0.4, "AI-elevated (Table 16)", ha="right", fontsize=7.5, color=TXT2)
    ax.text(1.02, len(CORE) - 20.6, "human-elevated (Table 16)", ha="right", fontsize=7.5, color=TXT2)
    handles = [Line2D([0], [0], marker="o", color="none", markerfacecolor=COL["human"], markersize=6, label="human mean (paper)"),
               Line2D([0], [0], marker="o", color="none", markerfacecolor="#8a8983", markersize=6, label="AI mean (paper)")]
    handles += [Line2D([0], [0], marker=mk, color="none", markerfacecolor=col, markersize=8, label=tl) for tl, fd, col, mk in texts]
    ax.legend(handles=handles, loc="lower center", bbox_to_anchor=(0.5, -0.12), ncol=3, frameon=False, fontsize=8)
    if title:
        ax.set_title(title, loc="left", fontsize=10, color=TXT1)
    fig.tight_layout(); fig.savefig(out, bbox_inches="tight"); plt.close(fig)
    return out


def fig_news_space(NS, overlays, out="fig_news_space.png", title=None):
    """PCA plane of the news mirror corpus (human vs. AI news) with scored texts overlaid.
    overlays: list of {label, pc1, pc2, color, marker, arrow_from}"""
    fig, ax = plt.subplots(figsize=(8.2, 5.0), dpi=170)
    _style(ax)
    P, y = NS.proj, NS.y
    mods = NS.df.model.values
    MC = {"human": COL["human"], "sonnet": "#eb6834", "opus": "#eda100", "haiku": "#e87ba4"}
    MM = {"human": "o", "sonnet": "s", "opus": "D", "haiku": "^"}
    for m in ["human", "sonnet", "opus", "haiku"]:
        idx = mods == m
        ax.scatter(P[idx, 0], P[idx, 1], s=34, c=MC[m], marker=MM[m], alpha=0.8, edgecolors="white", linewidths=0.6,
                   label={"human": "WinFuture 2017–2020 (human)", "sonnet": "Sonnet 5 mirror", "opus": "Opus 5.5 mirror", "haiku": "Haiku 4.5 mirror"}[m])
    for lab, idx, col, off in (("Zentroid menschliche News", y == 1, COL["human"], (-235, 62)), ("Zentroid KI-News", y == 0, "#8a8983", (-120, -44))):
        c = P[idx].mean(0)
        ax.scatter([c[0]], [c[1]], s=150, c=col, marker="D", edgecolors="white", linewidths=1.6, zorder=5)
        ax.annotate(lab, (c[0], c[1]), xytext=off, textcoords="offset points", fontsize=8.5, weight="bold", color=TXT1,
                    arrowprops=dict(arrowstyle="-", color="#777777", lw=0.6))
    def _rb(v):
        q1, q3 = np.percentile(v, [25, 75]); iqr = q3 - q1
        return max(v.min(), q1 - 2.5 * iqr), min(v.max(), q3 + 2.5 * iqr)
    lo1, hi1 = _rb(P[:, 0]); lo2, hi2 = _rb(P[:, 1])
    pad1, pad2 = 0.12 * (hi1 - lo1), 0.12 * (hi2 - lo2)
    n_out = int(((P[:, 0] < lo1 - pad1) | (P[:, 0] > hi1 + pad1) | (P[:, 1] < lo2 - pad2) | (P[:, 1] > hi2 + pad2)).sum())
    ax.set_xlim(lo1 - pad1, hi1 + pad1); ax.set_ylim(lo2 - pad2, hi2 + pad2)
    if n_out:
        ax.text(0.99, 0.02, f"{n_out} Ausreißer außerhalb des Ausschnitts", transform=ax.transAxes, ha="right", fontsize=7.5, color=TXT2)
    for o in overlays:
        if o.get("arrow_from") is not None:
            ax.annotate("", xy=(o["pc1"], o["pc2"]), xytext=o["arrow_from"], arrowprops=dict(arrowstyle="-|>", color="#333333", lw=1.1, shrinkA=6, shrinkB=6), zorder=7)
        ax.scatter([o["pc1"]], [o["pc2"]], s=o.get("size", 170), marker=o.get("marker", "*"), c=o.get("color", "#111111"), edgecolors="white", linewidths=1.2, zorder=8)
        ax.annotate(o["label"], (o["pc1"], o["pc2"]), xytext=o.get("offset", (8, -12)), textcoords="offset points", fontsize=8, color=TXT1, zorder=9,
                    bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.85))
    ax.set_xlabel("PC1 (news feature space, z-scored)"); ax.set_ylabel("PC2")
    ax.legend(loc="best", frameon=True, framealpha=0.9, edgecolor="none", fontsize=8)
    if title:
        ax.set_title(title, loc="left", fontsize=10, color=TXT1)
    fig.tight_layout(); fig.savefig(out); plt.close(fig)
    return out
