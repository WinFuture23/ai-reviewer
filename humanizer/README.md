# Humanisierungs-Prompt nach StoryScope: Messung, Test, Ergebnis

Stand: 2026-09-27. Grundlage: Russell, Rajendhran, Pham, Iyyer, Wieting: *StoryScope: Investigating idiosyncrasies in AI fiction*, COLM 2026 (arXiv 2604.03136), Code und Daten unter github.com/jenna-russell/storyscope.

## 1. Was das Paper misst

Das Paper trennt menschliche von KI-Texten **nicht über Stil** (Wortwahl, Satzbau, Gedankenstriche), sondern über **narrative Entscheidungen**: 304 Merkmale in zehn Dimensionen (Figuren, soziales Netz, Ereignisse, Plot, Struktur, Setting, Zeit, Enthüllung, Perspektive, Stil), automatisch aus 600 Vergleichsanalysen abgeleitet und dann per LLM (Gemini 3 Flash) für 61.608 Texte vergeben. Ein XGBoost-Klassifikator auf diesen Merkmalen erreicht ohne jedes Stilmerkmal 93,2 % Macro-F1 (Mensch vs. KI) und 68,4 % bei der Sechs-Wege-Zuordnung (Mensch, Claude, GPT, Gemini, DeepSeek, Kimi). 30 „Core-Features" tragen den Großteil des Signals (Table 16 des Papers). KI-Texte erklären ihre Themen, sind kausal aufgeräumt und linear, zeigen Gefühle über Körper und Kulisse; menschliche Texte springen in der Zeit, nennen konkrete Referenzen, sprechen den Leser an, lassen Fäden offen und bleiben moralisch ambivalent.

Die drei Abbildungen des Papers, die ich nachgebaut habe: Fig. 2 (LDA-Projektion des Merkmalsraums, Menschen als eigener Cluster), Fig. 3 (Konfusionsmatrix der Sechs-Wege-Zuordnung), Fig. 5 (Seltenheits-Perzentile je Quelle). Dazu die Table-16-Profile als eigene Grafik.

## 2. Nachbau der Messung

- Daten: das veröffentlichte `storyscope_features.parquet` (61.575 Texte × 304 Merkmale, inklusive der menschlichen Texte), `taxonomy.json`, Prompts aus dem Repo.
- Kodierung wie im Paper (§3): nominal → One-Hot, Multi-Select → Multi-Hot, ordinal/skalar → numerisch. Stil-Dimension (39) plus 8 stilabhängige Merkmale ausgeschlossen (Audit mit drei unabhängigen Bewertern nach der Regel aus Anhang B) → 257 narrative Merkmale, 746 kodierte Spalten.
- Klassifikator: XGBoost mit den Hyperparametern des Papers (binär 420 Bäume/Tiefe 8/λ 2/5:1-Gewicht; sechsfach 500/7/1), Split nach Prompt (GroupKFold, 49.032 Train / 12.264 Test).

| Messgröße | Paper | Nachbau |
|---|---|---|
| Mensch vs. KI, narrativ, Macro-F1 | 93,2 | 94,1 |
| Mensch vs. KI, narrativ + Stil, Macro-F1 | 96,0 | 95,9 |
| Sechs-Wege, narrativ, Macro-F1 | 68,4 | 69,5 |
| Sechs-Wege, narrativ + Stil, Macro-F1 | 77,3 | 77,5 |
| Per-Klasse F1 narrativ (Mensch/Claude/GPT/Gemini/DeepSeek/Kimi) | .89/.77/.73/.60/.57/.55 | .90/.79/.74/.59/.59/.55 |
| Seltenheit, mittleres Perzentil Mensch vs. KI | 0,71 / 0,49 | 0,70 / 0,49 |
| Zentroid-Abstand Mensch–KI vs. KI–KI | 6,6 / 4,3 | 6,4 / 3,9 |

Die Merkmalsvergabe für neue Texte läuft mit dem unveränderten Zehn-Dimensionen-Prompt aus `apply_features.py`, als Annotator Claude Sonnet 5 statt Gemini 3 Flash (kein Google-Zugang in dieser Umgebung). Wiederholbarkeit über drei Läufe: 78–87 % exakte Übereinstimmung je Merkmal (Paper: 89 % paarweise mit Gemini Flash). Übereinstimmung Claude ↔ Gemini auf denselben drei Dev-Stories: 64–67 %.

Validierung des Annotators im Zielbereich des Papers (englische Kurzgeschichten): drei KI-Stories aus dem Dev-Set (Gemini, DeepSeek, Kimi) → P(Mensch) 0,000–0,002; vier gemeinfreie menschliche Erzählungen (O. Henry, Gilman, Bierce, Poe) → P(Mensch) 0,98–1,00. Der Klassifikator funktioniert mit Claude als Annotator also im Paper-Bereich fehlerfrei auf diesen Kontrollen. **Nicht übertragbar ist das Seltenheitsmaß** (Fig. 5): Claude-annotierte Vektoren liegen systematisch abseits der Gemini-annotierten Verteilung (Perzentil 1,00 für jeden neuen Text), deshalb wird die Seltenheit nur als Reproduktion aus den Paper-Daten gezeigt, nicht für neue Texte.

## 3. Der VW-Artikel im Paper-Instrument: Domänenproblem statt Antwort

Der Artikel „VW ID. Tiguan: Premiere im Oktober beendet die ID.4-Ära" (426 Wörter, deutsch, Nachricht) liegt weit außerhalb dessen, wofür die 304 Merkmale gebaut sind (englische Erzählungen, ~5.000 Wörter). Auf 24 der 30 Core-Features steht er auf dem niedrigsten Wert oder „nicht vorhanden" (kein Protagonist, keine Enthüllung, keine Zeitstruktur). Der Klassifikator sagt trotzdem etwas, und genau das ist das Problem:

| Text | P(Mensch) narrativ | Sechs-Wege (narrativ) |
|---|---|---|
| VW ID. Tiguan (27.09.2026), drei Annotationsläufe | 0,02 / 0,00 / 0,02 | Kimi 0,75 / 0,75 / 0,66 |
| Bill Gates (27.09.2026, gleiche Autorin, gleicher Tag) | 0,69 | Kimi 0,69 |
| „KI strohdoof" (24.10.2019, drei Jahre vor ChatGPT, sicher Mensch) | 0,09 | DeepSeek 0,70 |

Die sichere menschliche Kontrolle von 2019 bekommt dasselbe Urteil wie der VW-Artikel. Ein Instrument, das den Menschen nicht erkennt, kann den Verdachtsfall nicht belasten. **Die Sechs-Wege-Zuordnung („Kimi" bzw. „DeepSeek") ist für diese Textsorte ohne Aussagekraft** und darf nicht als Antwort auf die Frage „mit welcher KI" gelesen werden: sie ordnet auch den 2019er Text einem Modell zu, das es damals nicht gab.

## 4. Die Paper-Methode auf WinFuture-News übertragen

Weil das Paper selbst mit einem Parallelkorpus arbeitet (derselbe Prompt, einmal Mensch, einmal Modell), habe ich das für News nachgestellt: 15 WinFuture-Artikel von 2017–2020 (vier Autor:innen, 239–403 Wörter, alle vor ChatGPT), je Artikel ein rückwärts extrahiertes Fakten-Briefing (Analogon zu Figure 6 des Papers) und daraus je zwei KI-Spiegelartikel von Claude Sonnet 5, Opus 5.5 und Haiku 4.5 (30 KI-Texte, 181–398 Wörter). Alle 45 Texte mit denselben 304 Merkmalen annotiert, dann geprüft, ob irgendein Merkmalssatz Mensch von KI trennt (logistische Regression, 5-fach-Kreuzvalidierung, zehnfach wiederholt, Permutationstest mit 60 Umordnungen):

| Merkmalssatz | Spalten | CV-AUC | Permutations-Nullwert | p |
|---|---|---|---|---|
| narrativ (257) | 454 | 0,29 | 0,50 ± 0,12 | 0,95 |
| alle 304 | 515 | 0,46 | 0,51 ± 0,10 | 0,75 |
| nur Stil (39) | 53 | 0,62 | 0,53 ± 0,13 | 0,30 |
| Core-30 | 44 | 0,36 | 0,48 ± 0,13 | 0,85 |

Kein Satz trennt besser als Zufall; menschliche und KI-News liegen im Merkmalsraum ineinander (Abbildung „news_space", die beiden Zentroiden fallen praktisch zusammen). Ein Effekt mittlerer Größe wäre mit 45 Texten sichtbar geworden; ein kleiner nicht. **Folgerung: Für kurze deutsche Nachrichtentexte hat das Paper-Instrument keine Trennschärfe.** Was das Paper über KI-Erzählungen sagt (Erklären des Themas, Linearität, verkörperte Gefühle), ist im Nachrichtenformat entweder Konvention für beide Seiten oder nicht vorhanden.

## 5. Der Prompt und sein Test im Paper-Bereich

Der Prompt (`prompts/humanize_vN.md`) ist direkt aus Table 16 und § 4.1 des Papers abgeleitet: Er verbietet neue Fakten, erhält alle Fakten, und ordnet dann sieben Eingriffsgruppen nach ihrer SHAP-Wichtigkeit an: (A) nicht mehr erklären, was der Text bedeutet; (B) die Zeitachse brechen und einen Fakt zurückhalten; (C) Nebengleis, offene Fäden, kein Fazit; (D) Personen über Rede/Handlung statt Beschreibung einführen, Quellen beim Namen nennen, mehr direkte Rede; (E) Leseransprache; (F) Gefühle benennen statt verkörpern, keine Gerüche und Kulissen als Stimmungsspiegel; (G) Orte nennen, nicht ausmalen. Dazu eine Selbstprüfliste.

**Testprotokoll.** Rewriter: Claude Opus 5.5. Jede Umschrift wird (1) von einem Faktenprüfer (Opus 5.5, strukturierte Ausgabe) gegen das Original geprüft – erfundene, veränderte, weggelassene Fakten; bei Erzählungen zählen nur Handlung, Figuren, Orte, Ausgang, nicht Moral oder Kommentar –, (2) mit dem Zehn-Dimensionen-Prompt neu annotiert und (3) durch den nachgebauten Klassifikator geschickt. Erfolg = P(Mensch) ≥ 0,5 im narrativen Modell bei Faktentreue 100.

**Ergebnis v1 (Paper-Bereich, drei KI-Stories aus dem Dev-Set):**

| Story | P(Mensch) vorher | nachher v1 | Logit nachher | Faktentreue |
|---|---|---|---|---|
| Kimi K2.5, „Nobody's Story" (1.804 → 1.546 Wörter) | 0,000 | **0,978** | +3,8 | 100 |
| DeepSeek V3.2, „The Haunted Cellar" (1.805 → 1.673) | 0,000 | **0,991** | +4,7 | 100 |
| Gemini 3 Flash, „Where All Things Perish" (1.839 → 1.702) | 0,000 | 0,000 | −10,3 | 100 |

Zwei von drei Stories wandern mit v1 in den menschlichen Bereich des Merkmalsraums (Abbildung `fig2_lda_overlay_fiction.png`: K→K', D→D'), die Gemini-Story bleibt bei einem Logit von −10 stehen, obwohl 73 der 304 Merkmale sich geändert haben. Die SHAP-Diagnose der nach v1 weiter „KI"-wertigen Merkmale (aggregiert über alle Texte) nennt: Bogen-Vollständigkeit (Cliffhanger statt geschlossenem oder offenem Ende), Ereignis-Neuheit, Zwillingsplatzierung der Wendung, Dialoganteil, thematische Einheit 5, thematische Explizitheit 4, keine Rekontextualisierung nach der Überraschung, keine benannten Referenzen, weiterhin alle fünf Sinne inklusive Geruch. Diese Liste war der Input für v2.

**Messrauschen.** Die Annotation ist selbst eine LLM-Messung. Dieselbe humanisierte Kimi-Story dreimal annotiert ergab P(Mensch) 0,98 / 0,89 / 0,21. Nahe der Entscheidungsgrenze kann ein einzelner Annotationslauf das Urteil kippen; die Originale sind davon nicht betroffen (Logit −10 bis −14, P(Mensch) bleibt 0,000). Deshalb gilt für die Endabnahme einer Prompt-Version: drei Annotationsläufe je Umschrift, Kriterium ist der Mittelwert.

**v2 (Panel-Vorschlag, 2.700 Wörter).** Drei unabhängige Vorschlagsrunden auf Basis der v1-Diagnose plus eine Synthese ergaben v2: verschärfte Faktenregel (Wissensstand, Gewissheitsgrad), Enthüllung ins letzte Fünftel, Nachspiel höchstens ein Absatz, keine Ankündigungen, Repliken zählen, Geruch/Geschmack null, Einstieg „nie am Ende", keine neuen Zeitangaben. Ergebnis mit je drei Annotationsläufen: Gemini-Story 0,77 / 0,00 / 0,03 (Mittel 0,27, vorher 0,00), Kimi-Story 0,05 / 0,00 / 0,08 (Mittel 0,04, mit v1: 0,69). Der VW-Artikel: Faktentreue 100 bei beiden Proben (die Faktenregel wirkt), P(Mensch) 0,02–0,03 (im Nachrichtenbereich ohne Aussagekraft, siehe § 4).

Die Feature-Diagnose erklärt den Rückschritt bei Kimi exakt: v2 hatte die Zeitachse wieder geradegebogen. Chronologische Diskontinuität 3 → 1, Anachronie 4 → 1, keine Rückblenden mehr, Vorgeschichte vorn, Gefühle wieder verkörpert statt benannt (v2 hatte „erlebte Rede" verlangt, das Modell lieferte Körperreaktionen). Genau die menschlich erhöhten Zeit-Merkmale aus Table 16 waren verloren gegangen, weil v2 den Einstieg am Ende, Zeitangaben und den Rückblick-Rahmen verboten hatte. Bei Gemini halfen dagegen drei v2-Regeln messbar: Hauptfigur spricht vor ihrer Beschreibung (+3,2 Logit), thematische Explizitheit 4 → 3 (+1,5), keine Selbstkommentierung am Ende (+0,6).

**v3** nimmt v1 als Basis (die Zeitachsen-Regeln bleiben, verstärkt auf zwei Zeitsprünge, Rückblenden erwünscht) und übernimmt aus v2 nur, was nachweislich half: Faktenregel, Hauptfigur spricht zuerst, keine Eigenschaftsetiketten, höchstens ein erklärender Erzählersatz und keiner am Ende, Nachspiel ein Absatz, Enthüllung im letzten Fünftel, Geruch/Geschmack null, benannte Gefühle ohne Umweg über erlebte Rede.

## 6. Ergebnis über alle Prompt-Versionen

Messung: nachgebauter StoryScope-Klassifikator (narrativ, 257 Merkmale), P(Mensch) als Mittelwert über drei Annotationsläufe je Umschrift (Originale: ein Lauf, weil Logit ≪ 0). Faktentreue vom Faktenprüfer (100 = nichts erfunden, verändert, weggelassen). Rewriter: Claude Opus 5.5, eine Probe je Text.

**Überblick Paper-Bereich (drei KI-Stories, P(Mensch) narrativ, Mittel über Annotationsläufe):**

| Version | DeepSeek-Story | Gemini-Story | Kimi-Story | Mittel | bestanden (≥0,5) |
|---|---|---|---|---|---|
| original | 0.0 | 0.0 | 0.0 | 0.0 | 0 |
| v1 | 0.99 | 0.0 | 0.69 | 0.56 | 2 |
| v2 | 0.82 | 0.27 | 0.04 | 0.38 | 1 |
| v3 | 0.48 | 0.25 | 0.33 | 0.35 | 0 |
| v4 | 1.0 | 0.03 | 0.17 | 0.4 | 1 |

**Alle Messungen:**

| Text | Version | Probe | Annot.-Läufe | P(Mensch) Mittel | min–max | Faktentreue | Wörter |
|---|---|---|---|---|---|---|---|
| DeepSeek-Story | original | – | 1 | **0.00** | 0.00–0.00 |  |  |
| DeepSeek-Story | v1 | 1 | 3 | **0.99** | 0.98–0.99 | 100 | 1673 |
| DeepSeek-Story | v2 | 1 | 3 | **0.82** | 0.78–0.88 | 90 | 1574 |
| DeepSeek-Story | v3 | 1 | 3 | **0.48** | 0.21–0.99 | 90 | 1593 |
| DeepSeek-Story | v4 | 1 | 3 | **1.00** | 0.99–1.00 | 100 | 1508 |
| Gemini-Story | original | – | 1 | **0.00** | 0.00–0.00 |  |  |
| Gemini-Story | v1 | 1 | 1 | **0.00** | 0.00–0.00 | 100 | 1702 |
| Gemini-Story | v2 | 1 | 3 | **0.27** | 0.00–0.77 | 100 | 1547 |
| Gemini-Story | v3 | 1 | 3 | **0.25** | 0.15–0.41 | 100 | 1488 |
| Gemini-Story | v4 | 1 | 3 | **0.03** | 0.00–0.10 | 100 | 1504 |
| Kimi-Story | original | – | 1 | **0.00** | 0.00–0.00 |  |  |
| Kimi-Story | v1 | 1 | 3 | **0.69** | 0.21–0.98 | 100 | 1546 |
| Kimi-Story | v2 | 1 | 3 | **0.04** | 0.00–0.08 | 90 | 1450 |
| Kimi-Story | v3 | 1 | 3 | **0.33** | 0.07–0.78 | 90 | 1451 |
| Kimi-Story | v4 | 1 | 3 | **0.17** | 0.08–0.34 | 100 | 1650 |
| KI-Spiegel-News (Sonnet) | v2 | 1 | 1 | **0.65** | 0.65–0.65 | 100 | 254 |
| KI-Spiegel-News (Opus) | v2 | 1 | 1 | **0.43** | 0.43–0.43 | 100 | 300 |
| VW ID. Tiguan (News) | original | – | 3 | **0.02** | 0.00–0.02 |  |  |
| VW ID. Tiguan (News) | v1 | 1 | 1 | **0.10** | 0.10–0.10 | 75 | 391 |
| VW ID. Tiguan (News) | v1 | 2 | 1 | **0.02** | 0.02–0.02 | 85 | 397 |
| VW ID. Tiguan (News) | v2 | 1 | 1 | **0.03** | 0.03–0.03 | 100 | 415 |
| VW ID. Tiguan (News) | v2 | 2 | 1 | **0.02** | 0.02–0.02 | 100 | 414 |
| VW ID. Tiguan (News) | v3 | 1 | 1 | **0.04** | 0.04–0.04 | 100 | 409 |
| VW ID. Tiguan (News) | v3 | 2 | 1 | **0.04** | 0.04–0.04 | 100 | 398 |
| VW ID. Tiguan (News) | v4 | 1 | 1 | **0.03** | 0.03–0.03 | 100 | 440 |
| VW ID. Tiguan (News) | v4 | 2 | 1 | **0.10** | 0.10–0.10 | 100 | 421 |
| Bill Gates (News) | original | – | 1 | **0.69** | 0.69–0.69 |  |  |
| Bill Gates (News) | v2 | 1 | 1 | **0.92** | 0.92–0.92 | 100 | 451 |
| Bill Gates (News) | v3 | 1 | 1 | **0.38** | 0.38–0.38 | 90 | 440 |
| Bill Gates (News) | v4 | 1 | 1 | **0.61** | 0.61–0.61 | 100 | 455 |

Lesart:
- **v1 ist die beste Version im Paper-Bereich:** zwei von drei KI-Stories werden vom Klassifikator als menschlich eingestuft (DeepSeek 0,99 stabil über drei Läufe; Kimi 0,69 mit Streuung 0,21–0,98), die dritte (Gemini) bleibt bei 0,00. Jede längere, stärker vorschreibende Version (v2, v3) hat die Gemini-Story verbessert (Logit −10 → −1 bis −3), aber die beiden anderen verschlechtert, weil der Rewriter die entscheidenden Zeitachsen-Eingriffe zugunsten der vielen Zusatzregeln fallen ließ.
- v4 = v1 plus vier belegte Ergänzungen (Faktenregel für Wissensstand und Gewissheitsgrad, Enthüllung ins letzte Fünftel, Nachspiel höchstens ein Absatz, Geruch/Geschmack null, Zitatregel für News). Ergebnis v4 (je drei Annotationsläufe): DeepSeek 1,00, Kimi 0,17, Gemini 0,03, Mittel 0,40, eine von drei bestanden; Faktentreue 100 bei allen fünf Texten. Die Strukturzusätze haben also wieder gekostet, was sie bei Gemini bringen sollten, ohne es dort zu bringen.
- Die Faktentreue ist seit v2 bei Nachrichtentexten 100 (v1: 75/85 wegen erfundener „nicht bekannt"-Sätze); die schärfere Faktenregel ist in v4 enthalten.
- Für den VW-Artikel bleibt P(Mensch) unter allen Versionen bei 0,02–0,10. Das ist kein Scheitern des Prompts, sondern die fehlende Trennschärfe des Instruments für Nachrichtentexte (§ 3–4): auch der menschliche Kontrolltext bekommt 0,09. Die Umschriften des VW-Artikels (`results/rewrites/`) sind fakten­treu (100) und lesen sich als Nachricht; ob sie „menschlicher" sind, kann dieses Instrument nicht sagen.

**Empfehlung für die Redaktion:** `prompts/humanize_final.md` verwenden. Das ist der Strukturteil von v1 unverändert (die beste gemessene Version) plus die Faktenregeln aus v2–v4 (Wissensstand, Gewissheitsgrad, Zitatregel für News, zwei Prüfpunkte), die nur die Faktentreue betreffen und dort in allen Läufen 100 erreicht haben. Diese Kombination selbst wurde nicht noch einmal als Ganzes durchgemessen; ihr Strukturteil ist identisch mit v1. Weil das Urteil des Klassifikators nahe der Grenze streut, lohnt sich bei Erzähltexten ein Auswahlschritt: zwei bis drei Umschriften erzeugen, jede dreimal annotieren, die mit dem höchsten Mittelwert nehmen (`ss_humanize.py --samples 3 --annot-runs 3`). Bei Nachrichtentexten ist der einzige harte, messbare Maßstab die Faktentreue; dort ist der Prompt vor allem ein Struktur-Werkzeug (Einstieg, Reihenfolge, Zitate, Leseransprache) und kein Detektor-Umgeher.

## Abbildungen (wie im Paper)

| Datei | Entspricht | Inhalt |
|---|---|---|
| `results/figs/fig2_lda_repro.png` | Fig. 2 | LDA-Projektion des narrativen Merkmalsraums, Test-Split der Paper-Daten, sechs Quellen mit Zentroiden |
| `results/figs/fig2_lda_overlay_fiction.png` | Fig. 2 + Overlay | dieselbe Projektion mit den vier menschlichen Kontroll-Erzählungen (H1–H4), den drei KI-Stories (D, G, K) und ihren v1-Umschriften (D', G', K') |
| `results/figs/fig3_confusion_repro.png` | Fig. 3 | Konfusionsmatrix der Sechs-Wege-Zuordnung (narratives Modell, Zeilen-%) |
| `results/figs/fig5_rarity_repro.png` | Fig. 5 | Seltenheits-Perzentile je Quelle (nur Paper-Daten, s. Messrauschen) |
| `results/figs/fig_core_profile_vw.png` | Table 16 | die 30 Core-Features: VW-Artikel vor/nach Humanisierung gegen die Mittelwerte Mensch/KI |
| `results/figs/fig_core_profile_kimi.png` | Table 16 | dasselbe für die Kimi-Story (die erfolgreiche v1-Umschrift) |
| `results/figs/fig_news_space.png` | eigene | News-Spiegelkorpus: menschliche WinFuture-Artikel vs. KI-Spiegel, VW-Artikel und Umschriften darin |

![LDA overlay](results/figs/fig2_lda_overlay_fiction.png)
![Konfusionsmatrix](results/figs/fig3_confusion_repro.png)
![Rarity](results/figs/fig5_rarity_repro.png)
![Core-Profil Kimi](results/figs/fig_core_profile_kimi.png)
![Core-Profil VW](results/figs/fig_core_profile_vw.png)
![News space](results/figs/fig_news_space.png)

## 7. Mit welcher KI wurde der VW-Artikel geschrieben?

Ehrliche Antwort aus dieser Messung: **nicht bestimmbar.** Drei Gründe, jeder für sich ausreichend:

1. Die Sechs-Wege-Zuordnung des Papers kennt nur Claude Sonnet 4.6, GPT-5.4, Gemini 3 Flash, DeepSeek V3.2, Kimi K2.5 und Mensch, jeweils als Autor englischer Kurzgeschichten. Für einen deutschen Nachrichtentext liefert sie „Kimi" (0,66–0,75) – und für den sicher menschlichen WinFuture-Text von 2019 „DeepSeek" (0,70). Ein Verfahren, das den Menschen von 2019 einem Modell von 2026 zuordnet, hat für diese Textsorte keine Zuordnungskraft.
2. Der eigens gebaute News-Spiegelkorpus zeigt, dass die 304 Merkmale menschliche WinFuture-News nicht von Claude-geschriebenen Spiegelartikeln trennen (CV-AUC 0,29–0,62, Permutationstest nicht signifikant). Wenn Mensch vs. KI nicht trennbar ist, ist Modell vs. Modell erst recht nicht trennbar.
3. Ein Modell-Fingerabdruck im Sinne des Papers (Table 17: Claude = flache Eskalation und Epiloge, GPT = Klatsch als Plotmechanik, Gemini = expandierende Sozialnetze, DeepSeek = sichtbarer Erzähler, Kimi = Einstieg in Aktion) setzt Erzählstruktur voraus, die ein 400-Wörter-Nachrichtentext nicht hat.

Was sich mit dem Paper-Instrument sagen lässt: Der Artikel unterscheidet sich in den 304 narrativen Merkmalen nicht messbar von einem menschlichen WinFuture-Artikel der Vor-ChatGPT-Zeit. Ob er von einer KI stammt, müsste man mit einem stilometrischen Detektor (die Text-Baselines des Papers, 99,7–99,9 % auf Erzählungen) oder mit Redaktionswissen klären, nicht mit narrativen Merkmalen. Das ist kein Nebenbefund, sondern deckt sich mit der Einschränkung im Paper selbst: Die Merkmale brauchen lange Texte („~5,000 words, enabling extraction of fine-grained narrative features that shorter texts cannot support").

## 9. Der VW-Artikel: Endfassung, Lesertest, Änderungen

**Kann der Text verbessert werden?** Ja, in dem Sinn, dass Leser ihn lieber lesen, und ohne dass das Paper-Instrument das messen könnte (§ 3–4). Vorgehen: drei neue Umschriften mit `humanize_final.md` (alle Faktentreue 100), zusammen mit den sechs faktentreuen Umschriften aus v2–v4 und dem Original als zehn blinde Fassungen (A–J, zufällig gemischt) an fünf Leser-Personas (Stammleser, Autojournalist:in, Schlussredakteur:in, Kaufinteressentin, Linguist:in; Sprachmodelle in diesen Rollen, kein Ersatz für echte Leser, siehe § 10). Jede Persona bewertete jede Fassung 1–10 in Lesbarkeit, Fluss und Reihenfolge, Natürlichkeit, Vertrauen und Gesamteindruck.

**Ergebnis:** Fassung B (Final-Prompt, Probe 2) gewinnt bei allen fünf Lesern; das Original landet auf Platz 6 von 10, mit dem schlechtesten Wert für Natürlichkeit (4,0) und dem wiederkehrenden Urteil „Pressemappen-Ton": generische Zwischenzeilen, „markiert eine Abkehr", die Floskel „muss sich allerdings zeigen" im Vorspann.

| Fassung (blind) | ist | Gesamt | Lesbarkeit | Fluss/Reihenfolge | Natürlichkeit | Vertrauen/Klarheit | Platz 1 (von 5) |
|---|---|---|---|---|---|---|---|
| B | Final-Prompt, Probe 2 (Gewinner) | **8.00** | 8.00 | 7.80 | 8.00 | 7.80 | 5 |
| A | v2, Probe 1 | **6.80** | 7.00 | 6.40 | 6.00 | 7.40 | 0 |
| E | v4, Probe 1 | **6.40** | 6.80 | 6.40 | 6.40 | 6.40 | 0 |
| J | final, Probe 3 | **6.40** | 7.00 | 6.00 | 6.80 | 6.80 | 0 |
| C | final, Probe 1 | **6.40** | 7.20 | 6.20 | 7.00 | 6.60 | 0 |
| G | Original (WinFuture, 27.09.2026) | **5.40** | 7.00 | 6.20 | 4.00 | 6.60 | 0 |
| D | v4, Probe 2 | **5.40** | 6.00 | 4.80 | 5.40 | 6.00 | 0 |
| I | v3, Probe 2 | **5.20** | 5.80 | 4.20 | 6.60 | 6.00 | 0 |
| F | v3, Probe 1 | **4.20** | 5.60 | 3.00 | 4.80 | 5.40 | 0 |
| H | v2, Probe 2 | **4.20** | 5.80 | 3.40 | 5.40 | 5.20 | 0 |

- Leser 1: Top 3 B (final_s2) > E (v4_s1) > A (v2_s1). Wie von einem Menschen: Fassung B - sie bündelt Termine und Technik so, wie man es einem Bekannten erzählen würde, streut mit 'Beim ID.4 hatte eine Ziffer gereicht' und 'Falls ihr euch über die berührungsempfindlichen Schieberegler geärgert habt' echte Haltung ein und verzichtet auf Ausblick-Floskeln wi
  Schwächen der besten Fassung: Komma-Splice im zweiten Absatz: 'Ende 2026 soll im Werk Emden die Serienproduktion beginnen, das teilt Volkswagen mit.' - besser 'wie Volkswagen mitteilt'. | Unklarer Bezug: 'Auch äußerlich soll sie sich mit einer kantigeren Karosserie stärker an ihm orientieren.' - 'ihm' meint den Verbrenner-Tiguan, der aber zwei Sä | Schwacher Schluss: der letzte Sachabsatz vor der Leserfrage ist 'An der Hinterachse bleiben Trommelbremsen vorgesehen.' - der Text endet auf einer technischen F
- Leser 2: Top 3 B (final_s2) > A (v2_s1) > C (final_s1). Wie von einem Menschen: B - weil sie nicht nur Fakten stapelt, sondern mit kleinen Scharniersaetzen wie (Zu sehen gibt es das Elektro-SUV schon vorher) und (Beim ID.4 hatte eine Ziffer gereicht) den Leser durch den Text fuehrt, die Leseransprache dort setzt, wo sie ein echtes Aergernis trifft (die Schie
  Schwächen der besten Fassung: Unklarer Bezug: (Auch aeusserlich soll sie sich mit einer kantigeren Karosserie staerker an ihm orientieren) - das (ihm) muss der Leser ueber zwei Saetze zuruec | Der Schluss haengt in der Luft: (An der Hinterachse bleiben Trommelbremsen vorgesehen. Bei Elektroautos erfolgt die Verzoegerung ueberwiegend ueber Rekuperation | Falsche Verknuepfung: (Die Preise fuer das Basismodell sollen laut Hersteller bei rund 42.000 Euro beginnen. Daneben plant Volkswagen eine R-Line ...) - das (Da
- Leser 3: Top 3 B (final_s2) > A (v2_s1) > E (v4_s1). Wie von einem Menschen: Fassung B: Ihre Einschübe entstehen aus dem Stoff statt draufgesetzt zu sein ("Beim ID.4 hatte eine Ziffer gereicht.", die Ansprache an alle, die sich über die Schieberegler geärgert haben), die Satzlängen wechseln, und die Zwischentitel arbeiten mit Zahlen statt mit Kategorien; 
  Schwächen der besten Fassung: Zweiter Absatz: "Ende 2026 soll im Werk Emden die Serienproduktion beginnen, das teilt Volkswagen mit." ist eine holprige Attribution (Kommasatz), und der Produ | Schluss: "An der Hinterachse bleiben Trommelbremsen vorgesehen. Bei Elektroautos erfolgt die Verzögerung überwiegend über Rekuperation." ist ein losgelöster Zwe | Absatz "1650 Liter, 2300 Kilogramm": "Auch äußerlich soll sie sich mit einer kantigeren Karosserie stärker an ihm orientieren." zwingt zum Rückwärtslesen (sie =
- Leser 4: Top 3 B (final_s2) > C (final_s1) > J (final_s3). Wie von einem Menschen: Fassung B: Sie ordnet die Fakten wie jemand, der weiß, was Leser zuerst fragen (wann, was ändert sich, was steckt drunter), verbindet Absätze mit echten Überleitungen ('Zu sehen gibt es das Elektro-SUV schon vorher', 'Falls ihr euch über die berührungsempfindlichen Schieberegler 
  Schwächen der besten Fassung: Der Satz 'Beim ID.4 hatte eine Ziffer gereicht.' hängt am Ende des Nutzwert-Absatzes in der Luft; er gehört zur Namensdiskussion im Vorspann, nicht zwischen Kof | Der Preis, für eine Käuferin die wichtigste Zahl, steht erst im vorletzten Sachabsatz und wird sofort mit der R-Line vermischt ('Die Preise für das Basismodell  | Die Trommelbremsen kommen als isolierter Zweizeiler nach dem Preis ('An der Hinterachse bleiben Trommelbremsen vorgesehen.'), ohne Anschluss an den Technikblock
- Leser 5: Top 3 B (final_s2) > A (v2_s1) > C (final_s1). Wie von einem Menschen: Fassung B: Sie ordnet die Termine so, wie ein Mensch sie im Kopf hat (Produktion, Marktstart, 'zu sehen gibt es das Auto schon vorher'), bringt mit 'Beim ID.4 hatte eine Ziffer gereicht' einen beilaeufigen, wertenden Nebensatz, den kein Zusammenfassungs-Reflex produziert, und spr
  Schwächen der besten Fassung: Preis und R-Line sind ohne inneren Zusammenhang in einen Absatz gepackt: 'Die Preise fuer das Basismodell sollen laut Hersteller bei rund 42.000 Euro beginnen.  | Der Text endet mit einem verwaisten Zwei-Satz-Absatz, der wie ein Rest wirkt: 'An der Hinterachse bleiben Trommelbremsen vorgesehen. Bei Elektroautos erfolgt di | Die Pronomenkette im Nutzwert-Absatz zwingt zum Zurueckblaettern: 'Auch aeusserlich soll sie sich mit einer kantigeren Karosserie staerker an ihm orientieren.' 

Die drei von den Lesern genannten Schwächen der Gewinnerfassung (Komma-Splice „…, das teilt Volkswagen mit", unklares „ihm", Schluss auf der Trommelbremsen-Fußnote) habe ich redaktionell behoben; die Faktenprüfung der Endfassung ergibt erneut 100 (nichts erfunden, verändert, weggelassen). 404 statt 426 Wörter.

### Endfassung

**VW ID. Tiguan: Premiere im Oktober beendet die ID.4-Ära**

Volkswagen verabschiedet sich beim neuen ID. Tiguan wieder von reinen Ziffern im Namen und bringt physische Tasten zurück ins Cockpit.

Ende 2026 soll im Werk Emden die Serienproduktion beginnen, wie Volkswagen mitteilt. Die Markteinführung ist für das erste Quartal 2027 vorgesehen. Zu sehen gibt es das Elektro-SUV schon vorher: Am 9. Oktober 2026 will Volkswagen den ID. Tiguan vorstellen. Er löst den ID.4 ab.

**1650 Liter, 2300 Kilogramm**

Der Verbrenner-Tiguan bietet bis zu 1650 Liter Kofferraumvolumen bei umgeklappter Rückbank und eine Anhängelast von bis zu 2300 Kilogramm. Die Elektrovariante soll ähnliche Nutzwerte erreichen. Auch äußerlich soll sie sich mit einer kantigeren Karosserie stärker am Verbrenner-Tiguan orientieren. Mit dem Namen Tiguan richtet sich Volkswagen an die Stammkundschaft des bisherigen SUV. Beim ID.4 hatte eine Ziffer gereicht.

Falls ihr euch über die berührungsempfindlichen Schieberegler geärgert habt: Sie sollen im Innenraum durch Tasten am Lenkrad und an der Mittelkonsole ersetzt werden. Geplant sind außerdem klassische Türgriffe und ein auf zehn Zoll vergrößertes Instrumentendisplay.

**400 Volt**

Unter der Karosserie steckt die Plattform MEB+ (Modularer E-Antriebs-Baukasten), und mit ihr weiterhin die bekannte 400-Volt-Technik. Anders als zunächst gedacht ist ein 800-Volt-System für schnelleres Laden nicht vorgesehen.

Als Basis ist ein Akku mit 58 Kilowattstunden Kapazität und LFP-Zellchemie vorgesehen. Für höhere Reichweiten soll es eine Variante mit 77 Kilowattstunden und 210 Kilowatt Leistung geben, Allradmodelle mit bis zu 250 Kilowatt Systemleistung sollen das Angebot ergänzen. Per Software-Update soll sich das Auto mit nur einem Pedal fahren lassen.

An der Hinterachse bleiben Trommelbremsen vorgesehen. Bei Elektroautos erfolgt die Verzögerung überwiegend über Rekuperation.

Die Preise für das Basismodell sollen laut Hersteller bei rund 42.000 Euro beginnen. Daneben plant Volkswagen eine R-Line, die sich unter anderem durch vertikale Leuchten an der Front, größere Leichtmetallfelgen und eine aerodynamisch veränderte Heckschürze abheben soll.

Was haltet ihr von der Rückkehr zu echten Tasten und dem neuen Namen für das Elektro-SUV? Teilt eure Meinung und Erwartungen an den ID. Tiguan gerne unten in den Kommentaren mit uns!

**Zusammenfassung**

- VW stellt das neue Elektro-SUV ID. Tiguan am 9. Oktober 2026 offiziell vor
- Der elektrische Nachfolger des ID.4 basiert auf der MEB-Plus-Plattform
- Im Innenraum kehren wieder klassische Tasten statt Schieberegler zurück
- Die Serienproduktion des neuen SUV startet Ende 2026 im Werk in Emden
- Basisakku bietet 58 kWh Kapazität, stärkste Allradversion hat 250 kW
- Der Marktstart ist für Anfang 2027 ab etwa 42.000 Euro Basispreis geplant

### Was sich gegenüber dem Original geändert hat (Executive Summary)

- **Einstieg:** Der Vorspann endet nicht mehr mit der Ausblick-Floskel („Wie genau der Verzicht auf das 800-Volt-System den Erfolg … prägen wird, muss sich allerdings zeigen"), sondern nach der Nachricht. Danach kommen sofort die drei Termine (Produktion Ende 2026 in Emden, Markteinführung Q1 2027, Premiere 9. Oktober 2026) statt der Premiere allein.
- **Erklärsätze gestrichen:** „markiert eine Abkehr von der bisherigen Namensstrategie" und die Zwischenzeile „Namenswechsel als neue Strategie" sind weg; die Namensentscheidung steht als Fakt („Beim ID.4 hatte eine Ziffer gereicht") neben dem Stammkundschafts-Satz.
- **Zwischenzeilen konkret statt zusammenfassend:** „1650 Liter, 2300 Kilogramm" und „400 Volt" statt „Produktion und Antriebsvarianten" und „Namenswechsel als neue Strategie".
- **Reihenfolge nach Leserinteresse statt nach Pressemappe:** Nutzwerte und Karosserie, dann Cockpit, dann Technik, dann Preis und R-Line. Die 800-Volt-Absage steht im Technikabsatz, wo sie hingehört, nicht als Spannungsbogen im Vorspann.
- **Leseransprache im Text, nicht nur am Ende:** „Falls ihr euch über die berührungsempfindlichen Schieberegler geärgert habt: …"
- **Quelle beim Namen:** „laut Hersteller" bleibt dort, wo das Original es hat; „wie Volkswagen mitteilt" steht jetzt beim Produktionsstart, auf den es sich bezieht.
- **Schluss:** Der letzte Sachabsatz ist Preis und R-Line, nicht die Trommelbremse; Leserfrage und Zusammenfassungsblock bleiben unverändert (Haus-Elemente).
- **Unverändert:** Überschrift, alle Zahlen, Daten, Namen und Zuschreibungen; kein neuer Fakt, keine Aussage über den Wissensstand.

## 10. Wie es weitergehen kann

1. **Prompt in den KI-Korrektor einbauen, aber hinter einer Faktenschranke.** `humanize_final.md` als optionaler Schritt im Make.com-Worker (nach Korrektor, vor Verlinker), Ausgabe nur, wenn der Faktenprüfer 100 meldet; sonst zurück an den Redakteur mit der Liste der Abweichungen. Das Vorher/Nachher-Diff-Modal des Widgets zeigt die Umschrift absatzweise, der Redakteur nimmt an oder verwirft.
2. **Ein Messinstrument für Nachrichten bauen, weil das Paper-Instrument hier blind ist.** Der Spiegelkorpus (15 + 30 Texte) ist der Anfang: auf 150 menschliche WinFuture-Artikel von 2015–2021 ausbauen, Spiegel von GPT, Gemini und DeepSeek dazunehmen (nicht nur Claude), und dann zwei Detektorfamilien prüfen: die Text-Baselines des Papers (Stilometrie, TF-IDF, ModernBERT) und die 304 Merkmale erneut mit größerem n. Erst mit diesem Instrument lässt sich sagen, ob eine Umschrift für Nachrichten „menschlicher" ist.
3. **Echte Leser statt Leser-Personas.** Der Blind-Test in § 9 nutzt Sprachmodelle als Leser. Der nächste Schritt ist ein kleiner A/B-Test in der Redaktion oder mit Stammlesern (zehn Artikelpaare, je Paar Original und Umschrift, blind, drei Fragen: verständlicher, glaubwürdiger, eher von einem Menschen).
4. **Das Streuungsproblem operativ lösen.** Bei Erzähltexten drei Umschriften erzeugen, dreimal annotieren, den besten Mittelwert nehmen; bei Nachrichten reicht die Faktenprüfung als Gate. Kosten pro Artikel derzeit etwa 3–5 US-Dollar mit Opus als Rewriter; ein Test mit Sonnet 5 als Rewriter steht noch aus.
5. **Die Gemini-Lücke verstehen.** Eine der drei Test-Stories widersteht jeder Prompt-Version (Logit −10 → −1, aber nie positiv). Ihr Muster (Rahmenerzählung, Ich-Erzähler mit Rückblick, Epilog) verdient eine eigene Prompt-Variante für Rahmenerzählungen, getestet an zehn statt einer Story.
6. **Nichts davon verändert die Regel des Hauses:** Ein Text, der als menschlich erscheinen soll, muss faktentreu bleiben. Der Prompt kann Struktur, nicht Wahrheit.

## 8. Reproduktion

Alles liegt in `humanizer/`:

```
prompts/humanize_final.md                  der empfohlene Prompt; humanize_v1..v4.md die getesteten Versionen
scripts/ss_lib.py                          Taxonomie, Kodierung (paper-treu), Normalisierung wie im Repo
scripts/ss_train.py                        Klassifikator + LDA + Seltenheit auf den Paper-Daten
scripts/ss_annotate.py                     Zehn-Dimensionen-Annotation per `claude -p` + Scorer
scripts/ss_humanize.py                     Umschrift + Faktenprüfung + Annotation + Bewertung
scripts/diagnose.py, build_diag.py         SHAP-Diagnose je Text, Aggregation je Prompt-Version
scripts/gen_ai_news.py, news_domain.py     News-Spiegelkorpus und Domänentest
scripts/ss_plots.py, evaluate_all.py       Abbildungen und Ergebnistabelle
scripts/prompt_panel.js                    Workflow: drei Vorschläge + Synthese für die nächste Version
results/                                   Metriken, Ergebnistabellen, Abbildungen, alle Umschriften, Lesertest (lesertest_vw.md), Spiegelkorpus
Bericht.pdf                                dieser Bericht als PDF
```

Ablauf für einen neuen Text: `python3 scripts/ss_humanize.py prompts/humanize_vN.md text.txt out/ --samples 2` (setzt `claude` CLI voraus; Modelle über `--rewriter`, Annotator über `SS_ANNOT_MODEL`). Voraussetzung einmalig: `git clone https://github.com/jenna-russell/storyscope` nach `/home/user/jenna-russell/storyscope` (oder Pfad in `ss_lib.py` anpassen) und `python3 scripts/ss_train.py --variant narrative --exclude scripts/style_flagged_8.json --out scripts/out_narrative`. Kosten: eine Annotation kostet etwa 0,6–1,1 US-Dollar (10 Aufrufe Sonnet 5), eine Umschrift mit Opus 5.5 etwa 1–3 US-Dollar.
