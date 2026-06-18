# `vergleichswidget.js` — Detail-Doku

Eigenständiges, abhängigkeitsfreies Diff-Modal für die **redaktionelle
Gegenüberstellung** zweier Versionen eines WinFuture-Artikels:

- **Vorher** — die Original-Fassung, die der Redakteur geschrieben hat.
- **Nachher** — die KI-bearbeitete Fassung.

Der Redakteur geht jede Änderung Absatz für Absatz durch, entscheidet
pro Absatz, ob die Nachher-Variante übernommen wird, und darf den
Nachher-Text zusätzlich inline noch nachjustieren. Ergebnis ist ein
fertiger String pro Sektion (Headline / Teaser / Content), der HTML-
und `##`-Shortcode-Markup byte-genau aus dem Eingabe-Material erhält.

Wird im KI-Korrektor lazy nachgeladen, wenn der Button „🔍 Unterschiede
anzeigen" geklickt wird. Standalone testbar über
[`docs/vergleichswidget-demo.html`](vergleichswidget-demo.html).

## Public API

```js
VergleichsWidget.open( {
    before: {
        headline: '...',         // optional — Sektion wird weggelassen, wenn leer
        teaser:   '...',         // optional
        content:  '<h2>…</h2>…'  // Body inkl. HTML & ##-Codes
    },
    after: { headline, teaser, content },

    title:              'Unterschiede',     // optional
    defaultMode:        'pseudo',           // 'pseudo' | 'editor', Default 'pseudo'
    defaultOnlyChanges: true,               // boolean, Default true

    onResolve: function( resolved, stats ) {
        // resolved = { headline, teaser, content }  — byte-exakt
        // stats    = { total, accepted, rejected }
    },
    onClose: function() { … }
} );
```

**Backwards-Compat**: `before`/`after` dürfen auch reine Strings sein.
Dann wird der String als `content` behandelt, `onResolve` bekommt einen
einzelnen String zurück.

`window.VergleichsWidget._internal` exportiert intern genutzte Helfer
(`tokenize`, `diff_tokens`, `split_paragraphs`, `build_rows`,
`resolve_text`, `render_text_html`, `restore_invisible_markers`,
`restore_soft_hyphens`, `restore_nbsp`) für Tests.

## Heilige Kuh: Source-Integrität

**Wichtigste Anforderung überhaupt — brich sie nicht.**

Das Widget verändert **niemals** den Artikelinhalt. Was an `before`
und `after` übergeben wird — auch wenn es `<script>`-Tracker, `onclick`-
Handler, `javascript:`-URLs, `<form>`/`<input>`/`<button>`/`<textarea>`,
`##`-Codes oder beliebigen anderen Markup enthält — kommt byte-für-
byte über `onResolve` zurück. Die Entscheidung des Redakteurs bestimmt
nur, ob für einen Absatz die Vorher- oder Nachher-Variante gewählt
wird.

**Einzige bewusste Ausnahme — `restore_invisible_markers`**: Redakteure
setzen `&shy;` (weiche Trennzeichen, z. B. `Elektro&shy;mobilität`) und
`&nbsp;` (geschützte Leerzeichen, z. B. `100&nbsp;km/h`) gezielt, und die
KI strippt sie trotz Prompt-Vorgabe immer wieder. Vor dem Diff läuft
deshalb `restore_invisible_markers( before, after )` über die `after`-
Sektion und stellt die Marker dort wieder her, wo das umgebende Wort
bzw. der unmittelbare Kontext im Nachher identisch ist. Wirkt
**ausschließlich auf `after`**, nie auf `before`. Bei vollständig
umformulierten Wörtern wird nichts restauriert — die Position wäre
dann nur Raten. Code: Section 2.5 in `vergleichswidget.js`.

**Was Sanitisierungen wo machen:**

| Stelle | Wirkt auf | Beispiel |
|---|---|---|
| `render_tag()`, `syntax_*()`, `render_*()` | nur die HTML-Darstellung im Modal | strippt `onclick=`, `javascript:`, `data:` aus der `<a>`-Kopie, die ins `innerHTML` geht |
| `DANGEROUS_TAGS` (script, style, iframe, …) | nur die Darstellung | escapt das Tag zu Text — der Quelltext bleibt für den Editor lesbar |
| `resolve_text()` | gibt `row.before` bzw. `row.after` zurück | **unverändert**, mit allen ursprünglichen Tags & Attributen |

Verifizierbar:

```js
const rows = VergleichsWidget._internal.build_rows( beforeBundle, afterBundle );
rows.forEach( r => r.decision = 'accept' );
const acc = VergleichsWidget._internal.resolve_text( rows );
rows.forEach( r => r.decision = 'reject' );
const rej = VergleichsWidget._internal.resolve_text( rows );
console.assert( acc.headline === afterBundle.headline );
console.assert( acc.teaser   === afterBundle.teaser );
console.assert( acc.content  === afterBundle.content );
console.assert( rej.headline === beforeBundle.headline );
// … usw.
```

Bricht das, ist eine Kernanforderung verletzt — beheben, bevor
irgendetwas anderes.

## Designziele (in Reihenfolge der Wichtigkeit)

1. **Byte-exakte Erhaltung** — siehe oben.
2. **Konzentration auf Text und Änderungen.** Alles, was den Blick auf
   die textlichen Unterschiede stört, ist verboten:
   - Keine groben Layout-Platzhalter (z. B. „300×250 Anzeige"-Boxen,
     16:9-Video-Player). Andere `##`-Shortcodes als `##a##` werden
     visuell **komplett ausgeblendet**.
   - Keine Heading-Größen, kein Fett aus `<strong>`, kein Listen-
     Marker — nur `<h1>`–`<h6>` werden im Lesbar-Modus fett gerendert
     (als visuelle Zwischenüberschrift), Rest plain.
   - Kein Rot in der Syntax-Hervorhebung — Rot ist für Diff-Löschungen
     reserviert. Tag-Brackets grau-blau, Tag-Namen blau, Attribute
     bernstein, Strings teal, URLs blau, Shortcode-Namen indigo.
3. **Absatz-Alignment statt Token-Salat.** Vorher und Nachher werden
   absatzweise nebeneinander gestellt (3-Spalten-Grid). Wenn ein
   Absatz sich nur leicht ändert, erscheint er als „mod"-Zeile mit
   Inline-Diff-Highlights. Die Zeilen sind höhen-gestreckt, damit die
   Augen-Linie zwischen Vorher und Nachher synchron bleibt.
4. **Phrasen-Markierung durchgehend.** Mehrere benachbarte Wort-
   Änderungen werden ein durchgehender Balken, keine getrennten
   Wort-Boxen. Whitespace dazwischen wird mit-eingefärbt.
5. **Pro Absatz exakt eine Entscheidung.** Ein `×`/`✓`-Paar in einer
   dritten Spalte ganz rechts.
6. **Optionale Sektionen.** Headline und Teaser sind optional. Werden
   sie nicht übergeben (oder sind nur Whitespace), erscheint die
   zugehörige Sektion gar nicht.
7. **Minimale Tastatursteuerung.** `↑`/`↓` navigieren (auch zu schon
   entschiedenen Zeilen, damit Decisions revidiert werden können);
   `→` annehmen (Toggle), `←` ablehnen (Toggle), `Esc` schließen —
   außer in der Suchbox, dort nur Blur.
8. **Read-only Cells.** Beide Spalten sind nicht editierbar. Wer den
   Nachher-Text feinjustieren will, tut das nach dem Resolve direkt
   im Ziel-Editor — der bekommt das byte-exakte Bundle und kann es
   normal weiterbearbeiten.
9. **Höhe an Inhalt angepasst.** `max-height: 94vh` plus `height: auto`.
   Kurze Diffs → kompaktes Modal; lange Diffs → 94 vh + Scroll.

## Bewusst verworfen

Damit kein zukünftiger Refactor versehentlich Altlasten wieder
einführt:

| Verworfen | Warum |
|---|---|
| `##video##` als 16:9-Video-Player-Box, `##contentad##` als 300×250-Box | Layout-Theater, lenkt vom Text ab |
| Andere `##`-Shortcodes sichtbar darstellen (außer `##a##`) | Redakteur soll Text vergleichen, nicht Layout |
| Zeilennummern als Superscript vor jedem Absatz | optisch unruhig |
| „ÜBERSCHRIFT" / „TEASER"-Labels über Section-Zeilen | redundant — der gelbliche/bläuliche Hintergrund reicht |
| Pfeil-Bubbles (`→` / `←`) am Cell-Boundary für angenommen/abgelehnt | Doppelkommunikation zur Mittel-Linie + Opacity |
| Dark Mode | Light Mode genügt, weniger Komplexität |
| Wort-Level `×`/`✓`-Buttons (statt Absatz-Level) | zu unübersichtlich, Fehlerquelle |
| Whitelist von HTML-Tags fürs Rendering | Eingabe-Texte können beliebige Tags enthalten — wir akzeptieren alle, blacklisten nur Tags, die im Widget-Kontext aktiv eingreifen würden |
| `form`/`input`/`button`/`textarea` in `DANGEROUS_TAGS` | legitimer Artikelinhalt — der Redakteur muss diese Elemente sehen |
| Tastatur-Aliasse `N`/`P`/`Space`/`Enter`/`Delete`/`Backspace` | nur ↑/↓ + →/← + Esc — eindeutig und merkbar |
| Teaser kursiv | bewusst fett, gleicher Auszeichnungsgrad wie Headline, Unterschied nur über Hintergrundfarbe |
| Knalliges Blau für Links im Lesbar-Modus | dunkles Schiefergrau `#475569`, damit Diff-Farben dominieren |
| Feste Modal-Höhe `880px` | `max-height: 94vh; height: auto` |
| Leerzeile zwischen `<h2>` und Folge-Text im Lesbar-Modus | `h2 { margin: 0 }`; Quelltext-Newlines direkt nach `</h1-6>` werden im Renderer weggeworfen |
| „⎋ Schließen" im Footer-Hint | `× Schließen`-Button oben rechts reicht |
| Toggle-Label „HTML + Shortcodes" | umbenannt zu „HTML-Code" |
| Stripping von gefährlichen Konstrukten aus dem SOURCE | wird **nur aus der DISPLAY-Kopie** gestrippt; `row.before`/`row.after` und damit `resolve_text()` bleiben byte-exakt |

## Tastatur

| Taste | Wirkung |
|---|---|
| `↑` / `↓` | vorherige / nächste änderbare Zeile (cyclisch) |
| `→` | annehmen (Toggle bei Wiederwahl) |
| `←` | ablehnen (Toggle bei Wiederwahl) |
| `Esc` | schließen — außer in der Suchbox, dort nur Blur |

OS-Detection (`detect_os`) zeigt im Footer Mac-Symbole oder
Windows/Linux-Beschriftung. Auf Touch-Geräten ohne Hover wird der
Footer-Hint ausgeblendet.

## Zwei Anzeige-Modi

| Modus | Sicht | Schriftart | HTML | `##`-Shortcodes |
|---|---|---|---|---|
| `pseudo` (Default, „Nur Text") | wie eine Plain-Text-Druckseite | Monospace | Tags unsichtbar, außer `<h1>-<h6>` (fett) und `<a>` (Link) | nur `##a##` als Link, alle anderen unsichtbar |
| `editor` („HTML-Code") | Quelltext mit Syntax-Highlighting | Monospace | alles als Code, syntax-coloriert | alles als Code, syntax-coloriert |

Default für „Nur Änderungen" = an. Default-Modus = `pseudo`.

## Architektur-Konzepte

### Paragraph-Splitting (`split_paragraphs`)

Trenner: `\n+`, doppelte `<br>`-Sequenzen, schließende Block-Tags
(`</h1-6>`, `</p>`, `</li>`, `</blockquote>`, `</div>`, `</section>`,
`</article>`, `</aside>`, `</figure>`, …), sowie eigenständige
Block-Shortcodes (`##contentad##`, `##video##`, `##gallery##`,
`##embed##`, `##iframe##`, `##twitter##`, `##instagram##`,
`##youtube##`).

Ein Post-Processing-Schritt danach:

1. **Structural-empty merge**: Absätze, die nach Strippen aller HTML-
   Tags und Whitespace leer wären (`<br/><br/>`, einsame `\n`, leere
   `<p>`-Tags …), werden in den vorherigen Absatz gemergt. Sie
   tauchen nie als eigene Zeile im Grid auf — der Roh-Text bleibt aber
   als Teil des Mit-Absatzes erhalten.

> Früher gab es zusätzlich einen Heading-Merge-Schritt: `<h1>`–`<h6>`-
> Paragraphen wurden in den folgenden Body-Absatz hineingezogen, damit
> die Überschrift fett am Anfang des Body-Cells erscheint. Das Feature
> ist entfernt worden, weil es das Paragraph-LCS zerschossen hat sobald
> nur EINE Seite die Headings als `<h2>` formatiert hatte und die andere
> Plain-Text. Resultat damals: viele Add+Del-Reihen statt Mod-Pairs.
> Headings bleiben jetzt als eigene Zeilen — im Lesbar-Modus rendert
> der `<h1>`-`<h6>`-Inhalt weiterhin fett via CSS, der Redakteur kann
> Heading-Änderung und Body-Änderung separat akzeptieren/ablehnen.

### Diff (`build_rows` → `build_rows_from_paras`)

Drei separate Paragraph-LCS-Diffs (Headline / Teaser / Body), damit
eine Headline-Änderung das Body-Alignment nicht verschiebt. Pro
Sektion:

- LCS auf Paragraph-Strings.
- Gepaarte Del-+Ins-Runs werden via Jaccard-Ähnlichkeit (Schwelle 0.2)
  zu **Mod-Zeilen** zusammengeführt, damit minimal abweichende Absätze
  in derselben Grid-Zeile landen.
- **Inversions-Check beim Pairing** (`pair_similar`): Kandidaten-Pairs
  werden nach Score sortiert, aber nur akzeptiert, wenn sie die
  Reihenfolge gegen bereits akzeptierte Pairs erhalten (kein
  Crossover der (di, ii)-Indizes). Ohne diesen Check konnte z. B.
  eine `summary_box`, die in `before` oben und in `after` unten
  steht, mit der neuen summary_box gepaart werden — die resultierende
  Mod-Zeile landete an der Vorher-Position (oben), und
  `resolve_text` beim Default-Accept lieferte den Inhalt rotiert
  zurück (summary vor body). Mit dem Check wird so eine
  Lang-Distanz-Pair verworfen, die summary wird zu Del oben +
  Add unten — Reihenfolge bleibt korrekt.
- Mod-Zeilen, deren `before_display` und `after_display` nach
  Whitespace-Trim identisch sind, werden zu Eq-Zeilen umgewidmet
  (reiner Whitespace-Diff, der nichts hervorrufen darf).

Für jede Mod-Zeile läuft zusätzlich ein **Wort-Level-Diff** auf dem
getrimmten Display-Text — daraus entstehen die Inline-rot/grün-
Highlights.

### Continuous Highlighting (`render_cell`, 3-Pass)

- **Pass 1**: Filter auf die Seite (`del`+`eq` für Vorher, `ins`+`eq`
  für Nachher).
- **Pass 2**: Run-Same-Side-Ops werden über Whitespace-only-`eq`-Brücken
  zu einem einzigen Highlight-Run zusammengezogen.
- **Pass 3**: Render.

Damit ergibt eine Wortkette wie „Auswirkungen der schnell wachsenden
digitalen Infrastruktur" eine **durchgehende** rote Markierung statt
sechs einzelner Wort-Boxen.

### Visuelle Entscheidungs-Kommunikation

Pro Zeile gibt es drei visuelle Stellen, an denen sich der Decision-
Status ablesen lässt:

1. **`×`/`✓`-Buttons** in der dritten Spalte (Pflicht-UI).
2. **Mittellinie zwischen Vorher und Nachher** via `box-shadow`-Inset
   (3 px rechts an Vorher + 3 px links an Nachher):
   - gelb = aktive, noch unentschiedene Zeile,
   - grün = angenommen (Nachher gewinnt),
   - rot = abgelehnt (Vorher gewinnt).
3. **Opacity** der nicht gewählten Seite auf `.4`, der Auswahl-Seite
   voll.

Bewusst keine Pfeil-Bubbles, Section-Labels oder zusätzlichen
Indikatoren — die drei Quellen sind ausreichend redundant.

### Cells sind read-only

Beide Spalten (Vorher und Nachher) sind nicht editierbar. Inline-Edit
auf der Nachher-Seite gab es früher per `contenteditable="plaintext-only"`,
hat aber im Lesbar-Modus den Source-Markup zerstört (HTML-Tags und
`##`-Shortcodes sind dort visuell versteckt — der `innerText`-Sync ins
`row.after` hat sie damit auf die rendered Plain-Text-Version reduziert
und beim Resolve schlugen sie als kaputte Text-Inseln im Editor auf).

Heilige Kuh aus Sektion 3 verlangt byte-exakte Erhaltung; ein In-Modal-
Editor, der das einhält, würde einen weit aufwändigeren Source-Diff-Sync
brauchen. Bis dahin: Nachher-Text wird nach dem Resolve direkt im
Ziel-Editor weiterbearbeitet, der das byte-genaue Bundle eh schon hat.

Links in den Cells folgen `target="_blank" rel="noopener noreferrer"`
aus dem Renderer — Klick öffnet sie ganz normal in einem neuen Tab,
ohne weiteren JS-Eingriff.

## Sicherheit

Reine Client-Komponente, kein Auth-/Authz-Layer. Wirksame Sanitisierungen
(siehe oben: nur auf der **Display-Kopie**, nicht auf dem Source):

- **§14/§15 Metazeichen vor der Ausgabe** — `escape_html()` für
  `&<>"'` bei jedem Roh-Text-Insert in die DOM.
- **§17 Mehrschichtige Interpretation** — URLs in `href` werden gegen
  `DANGEROUS_URL_RE` geprüft, bevor sie klickbar werden.
- **§20 Defense in depth** — Tag-Blacklist + Event-Handler-Strip +
  URL-Schema-Strip + `rel="noopener noreferrer"`.

## Code-Stil (WinFuture-Konvention)

Siehe [Programmierstil.md](Programmierstil.md):

- **Snake_case** für interne Funktions-, Methoden- und Variablennamen
  (`escape_html`, `render_cell`, `build_rows`, `is_just_heading`, …).
- **Externe API bleibt camelCase** (`defaultMode`, `onResolve`,
  `onClose`, `defaultOnlyChanges`) — gängige JS-Konvention, alle
  bestehenden Einbettungen würden sonst brechen.
- Konstanten in `ALL_CAPS`: `CSS`, `TOKEN_RE`, `WORD_TOKEN_RE`,
  `PARA_BOUNDARY_RE`, `BLOCK_SHORTCODE_NAMES`, `DANGEROUS_TAGS`,
  `DANGEROUS_URL_RE`.
- **Kontrollstrukturen ohne Space vor `(`**: `if( cond )`,
  `for( i = 0; i < n; i++ )`, `function name( arg )`. Spaces innerhalb
  der Klammer wenn etwas drinsteht.
- **Tabs zum Einrücken**, Tab-Width 4.
- K&R-Klammern, öffnende Klammer auf derselben Zeile.

## Cell-Spezifität (CSS-Falle)

Die Cells in einer Zeile sind **Sibling-Grid-Items** (kein gemeinsamer
Row-Wrapper). Klassen wie `vw-row-resolved` werden daher **direkt auf
jede Cell** gesetzt. Selektoren arbeiten als **Compound** (z. B.
`.vw-cell-after.vw-row-resolved`), NIE als Descendant
(`.vw-row-resolved .vw-cell-after` würde nichts matchen, weil die
`.vw-row-resolved`-Klasse nicht auf einem Eltern-Element sitzt).

## Verwendung im KI-Korrektor

`ai-reviewer.js` lädt diese Datei lazy beim Klick auf „🔍 Unterschiede
anzeigen", baut `before` aus dem Backup vor dem KI-Lauf und `after`
aus den aktuellen Editor-Werten, und schreibt das `resolved`-Bundle
im `onResolve` byte-exakt zurück in die ACE-Editoren / DOM-Felder.

Software-Name (Download-Content-Type) wird aktuell **nicht** gediffed
— das VergleichsWidget unterstützt nur die drei festen Sektionen
Headline / Teaser / Content. Spätere Erweiterung möglich.

## Onboarding-Checkliste für Bearbeitung

1. Lies den Doc-Block oben in `vergleichswidget.js` und die kurzen
   Section-Marker (`// 1. CSS`, `// 2. Tokenizer + diff`, …).
2. Probier die Demo:
   ```bash
   cd "/Users/mesios/Downloads/_Code/KI Korrektor"
   python3 -m http.server 8765
   # → http://localhost:8765/docs/vergleichswidget-demo.html
   ```
3. **Verifiziere byte-exakt** nach jeder Änderung:
   ```js
   const rows = VergleichsWidget._internal.build_rows( beforeBundle, afterBundle );
   rows.forEach( r => r.decision = 'accept' );
   const acc = VergleichsWidget._internal.resolve_text( rows );
   console.assert( acc.headline === afterBundle.headline );
   // … gleiches für teaser, content, sowie für 'reject' → before
   ```

   Caveat: Wenn `beforeBundle` `&shy;` oder `&nbsp;` enthält und
   `afterBundle` sie verloren hat, ist `acc` **nicht** byte-gleich
   mit `afterBundle` — sondern mit der durch
   `restore_invisible_markers` rekonstruierten Variante. Das ist
   die dokumentierte Ausnahme. Für reine Roundtrip-Tests
   `beforeBundle` ohne Marker verwenden, oder direkt gegen
   `restore_invisible_markers( before, after )` testen.
4. **Etablierte Designentscheidungen nicht umwerfen** ohne Rücksprache.
   Die „Verworfen"-Liste oben ist *bewusst* so, nicht durch Versehen.
5. **Bei Sicherheitsänderungen**: nie SOURCE-Bytes anfassen. Sanitisierung
   ausschließlich in Render-Funktionen, nicht in `build_rows` /
   `split_paragraphs` / `resolve_text`.
