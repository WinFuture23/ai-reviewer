# `ai-reviewer.js` — Detail-Doku

Browser-Widget, das aus dem WinFuture-Editor heraus den Artikel an die
KI-Pipeline schickt, das Ergebnis pollt, in den Editor zurückschreibt
und Korrekturen + Verlinkungsvorschläge in einem schwebenden
Overlay-Panel rechts unten anzeigt. Single-File-IIFE, keine Dependencies,
ausgeliefert über GitHub Pages. Visuell an den VergleichsWidget-Look
angepasst (helles Theme, System-Sans-Serif, sanfte Akzent-Palette).

> Begleitdatei: [`vergleichswidget.js`](../vergleichswidget.js) — wird
> beim ersten Klick auf den Diff-Button lazy nachgeladen. Siehe
> [vergleichswidget.md](vergleichswidget.md).

## Zugriffsmodell

Seit Version 6 (12.10.2026) steht das Widget allen Redakteuren mit
Recht `r` offen. Die feste Liste von 9 User-IDs im Skript ist weg.

1. Das CMS gibt den Script-Tag nur für Redakteure mit Recht `r` aus
   (`wfv4_model_aireviewer`, alle `render*`-Methoden prüfen das Recht;
   Klasse wird intern im CMS gepflegt).
2. Das Widget startet nur mit Daten des CMS: Auth-Token
   (`window.wfv4_ai_reviewer_auth`, Editor) oder Rohdaten im Modus
   `pending` bzw. `status` (`window.wfv4_content.mode`). Ohne diese
   Daten returnt die IIFE silent, ohne DOM-Elemente anzulegen.
3. Den Backend-Aufruf sichert weiter der HMAC-Token des CMS
   (Artikel-gebunden, 90 Minuten gültig).

Die Namen der Prüfer liefert das CMS in `window.wfv4_ki_user_names`
(User-ID → Name). Die kurze feste Namensliste im Skript bleibt als
Rückfall. Doppelt eingebundene Scripts werden über das Flag
`window.wfv4_ai_reviewer_loaded` abgefangen.

Das CMS lädt das Skript mit fester Version in der Adresse
(`ai-reviewer.js?v=6`) und `async`. Der Browser behält es so
(GitHub Pages: 600 s, danach Prüfung per ETag). Ein langsames oder
fehlendes GitHub Pages hält die CMS-Seite nie auf.

## Prüf-Status für das CMS (seit Version 6)

In allen Modi meldet das Widget den Prüf-Status der aktuellen Fassung:

- `window.wfv4_ki_status = { state, ts, uid }` mit `state` aus
  `ok`, `markup`, `stale`, `none` oder `unknown` (keine Rohdaten).
- Ereignis `wfv4_ki_status` am `document` (`detail` wie oben).
- `wfv4_ki_marker.current()` rechnet den Status der Editor-Felder neu
  (`null` ohne Editor), `wfv4_ki_marker.open()` öffnet das Widget und
  startet die Prüfung wie ein Klick auf die Lasche.

Seit Version 7 stempelt das Widget mit `algo=2`. Beide Hashes gleichen
vorher die Zeichen an, die das CMS beim Speichern ersetzt: „ “ ” werden
zu `"`, ‚ ‘ ’ zu `'`, – und — zu `-`, … zu `...`, besondere Leerzeichen
zu einem Leerzeichen. Vorher galt eine eben geprüfte Fassung nach dem
Speichern als „veraltet“, sobald die KI solche Zeichen geschrieben hatte.
Einträge mit `algo=1` vergleicht das Widget weiter ohne Angleichen.

Modus `status` (`window.wfv4_content = { type, id, mode: 'status' }`
plus `window.wfv4_ki_raw`): keine Lasche, kein Panel, nur der Status.
Das CMS nutzt ihn auf Seiten ohne Editor, auf denen man freigibt
(Artikel-Ansicht, Video-Einstellungen, FAQ-Eintrag), und warnt vor
dem Freigeben einer ungeprüften Fassung. Ohne Status (Widget nicht
geladen) geht die Freigabe wie bisher: Das Widget ist Hilfe, nie Stopper.

Modus `pending` (Seite `/admin/news/ID/pending/`): Lasche und
Status-Panel stehen fest unten rechts. Bei `none` oder `stale` klappt
das Panel von selbst auf, aber nur ab 600 px Fensterbreite. Am Handy
zeigt die Lasche den Status, und das CMS warnt beim Aktivieren selbst.
Ein Abstandhalter am Ende von `body` (`#ai-reviewer-spacer`) ist so
hoch wie die sichtbare Lasche oder das Panel. So lassen sich die
letzten Knöpfe der Seite immer über das Widget scrollen (seit
12.10.2026, vorher verdeckte das Panel am Handy „Aktivieren“).

## Lebenszyklus

```
[Page Load]
  └─ IIFE prüft CMS-Daten + Loaded-Flag → exit oder weiter
  └─ init_widget() → Launcher-Tab rechts unten am Viewport
                     [🤖 KI-Korrektor]

[User klickt Launcher]
  └─ build_terminal()    (einmalig, Lazy)
     ├─ Header, Status-Bereich, Footer-Buttons, Resize-Handles
     └─ btn_check.click() (automatisch nach 100 ms)

[Check-Lauf]
  ├─ detect_content_info()   → liest window.wfv4_content
  ├─ gather_article_data()   → liest alle Felder aus ACE-Editoren
  ├─ backup_data = ...       → Snapshot für Rückgängig
  ├─ lock_editor()           → ACE auf readonly + Opacity-Overlay
  ├─ fetch(PROXY_URL, …)     → HMAC-authentifizierter Start-Request
  └─ poll_loop()             → adaptives Polling (s. unten)

[Poll-Loop liefert success]
  ├─ write_field_value()     → Korrekturen pro Feld zurückschreiben
  ├─ unlock_editor()
  ├─ Render Korrekturen + Verlinkungen ins Terminal
  ├─ btn_diff / btn_undo / btn_close_bottom werden sichtbar
  ├─ wfv4_link_preview.attach(...)  → Hover-Karten auf Linkboxen
  └─ Auto-Open (~350 ms)     → open_diff_modal({auto:true})
                               überspringt sich selbst, wenn nichts
                               zu vergleichen ist (Pre-Check)

[User entscheidet]
  ├─ „🔍 Unterschiede"  → open_diff_modal()  (Pre-Check + ggf. Modal)
  ├─ „↺ Rückgängig"     → write_field_value() aus backup_data
  └─ „💾 Speichern"     → Content-Type-spezifische Submit-Funktion
                          (wfv4_news_submit / form.requestSubmit)
```

## Content-Type-Konfiguration

`CONTENT_TYPES` mappt jeden unterstützten Typ auf seine Felder. Pro
Feld:

- `id` — DOM-Element-ID
- `type` — `'input'` oder `'textarea'`
- `ace_var` — Name der globalen ACE-Editor-Instanz (Konvention:
  `<textarea_id>_editor`), wenn vorhanden

```
| Typ | ID | Felder |
|---|---|---|
| News     | 6 | headline, teaser, content |
| Download | 8 | headline, software_name, content |
| Video    | 5 | headline, content |
| FAQ      | 1 | headline, content |
```

Lese- und Schreibzugriff laufen über `read_field_value(field_cfg)` und
`write_field_value(field_cfg, value)`. Sie bevorzugen den ACE-Editor
(falls `ace_var` gesetzt und `window[ace_var].getValue/setValue`
verfügbar) und fallen sonst auf das DOM-Element zurück.

`write_field_value()` setzt nach jedem Schreibvorgang
`window.wfv4_news_changed = true`, damit die existierende
„Ungespeicherte Änderungen"-Logik im CMS triggert.

## Polling

Asynchron, da der KI-Worker 2–3 Minuten braucht. Drei Optimierungen,
um Tabs im Hintergrund nicht abzuhängen:

1. **Adaptive Intervalle**: 30 s Grace → 15 s (bis 90 s) → 3 s
   (90–300 s) → 30 s (>300 s). Die schnelle Mittelphase fängt die
   wahrscheinlichste Antwort-Latenz ab.
2. **Tab-Boost**: bei `visibilitychange → visible` sofort ein
   Out-of-Band-Poll plus 60 s 4-Sekunden-Intervall.
3. **Interruptible Sleep**: das `setTimeout`-Wait in jeder Iteration
   kann von außen aufgeweckt werden, sodass ein Tab-Return-Poll
   unmittelbar gegen die gecachte Antwort iteriert.

Timeout: 5 Minuten. Nach Ablauf wird ein letzter Poll versucht,
und wenn auch der kein Ergebnis liefert, wird der Lauf abgebrochen.

## Auth

Die PHP-Klasse generiert einen HMAC-SHA256-Token, gebunden an
`{timestamp}|{content_type}|{content_id}` mit dem Shared Secret. Das
Widget schickt ihn als Header beim Start-Request mit:

```
X-Auth-Token: <hex>
X-Auth-Ts:    <unix-ts>
X-Auth-Ct:    <content_type>
X-Auth-Cid:   <content_id>
```

Der Val.town-Proxy verifiziert HMAC + Alter (max. 90 Min) und leitet
erst dann an Make.com weiter. Bei `HTTP 403` zeigt das Widget einen
„Seite neu laden"-Button (Token abgelaufen).

Der Poller-DB-Zugriff läuft separat über einen statischen API-Key
(`x-api-key: POLLER_API_KEY` Header).

## Editor-Lock / -Unlock

Während eines Laufs werden alle Felder des aktuellen Content-Typs
gesperrt:

- ACE-Editor: `setReadOnly(true)` + transparenter Overlay-Layer im
  Editor-Container, der Klicks abfängt, plus 50 % Opacity.
- Plain Inputs/Textareas: `disabled = true` + 50 % Opacity.

`unlock_editor()` hebt beides wieder auf. Wichtig: der Lock wird auch
im `catch`-Block des Polling-Loops zurückgesetzt, damit der Editor
nach einem Fehler nicht in einem sperrenden Zustand hängen bleibt.

## Diff-Anzeige (VergleichsWidget)

Zwei Auslöser, eine gemeinsame Funktion `open_diff_modal( opts )`:

- **Auto-Open** ~350 ms nach Success-Render — der Redakteur sieht das
  Vorher/Nachher-Modal sofort, ohne extra Klick. Ein `auto_diff_opened`-
  Flag verhindert mehrfaches Auf-Auf bei Re-Renders im selben Lauf;
  beim nächsten `btn_check`-Klick wird er wieder auf `false` gesetzt.
- **Manueller Klick** auf den Button „🔍 Unterschiede anzeigen" —
  derselbe Pfad, identisches Verhalten.

Ablauf in `open_diff_modal()`:

1. `ensure_vergleichswidget()` lädt `vergleichswidget.js` lazy nach,
   falls noch nicht geschehen. Die URL wird aus dem eigenen
   `<script src>` (`SELF_SCRIPT_URL`) abgeleitet.
2. `before` wird aus `backup_data` zusammengebaut (Snapshot vor dem
   KI-Lauf), `after` aus dem aktuellen Editor-Stand. Es werden nur
   die Felder befüllt, die der aktuelle Content-Typ tatsächlich hat
   (Headline / Teaser / Content — `software_name` bleibt aktuell aus).
3. **Pre-Check**: `VergleichsWidget._internal.build_rows( before, after )`
   wird vorab aufgerufen. Wenn keine Mod/Add/Del-Zeile dabei ist (= die
   KI hat den Text nicht angefasst), wird das Modal NICHT geöffnet —
   stattdessen erscheint bei manuellem Klick eine kurze Notiz im
   Terminal (beim Auto-Open keine Notiz, weil die Korrektur-Box im
   Terminal schon „Keine Änderungen" sagt).
4. Andernfalls: `VergleichsWidget.open({ before, after, onResolve })`
   öffnet das Modal. Der Redakteur entscheidet absatzweise.
5. In `onResolve(resolved, stats)` werden die drei `resolved.*`-Strings
   byte-exakt zurück in die Editor-Felder geschrieben — aber nur, wenn
   sie sich vom aktuellen Stand unterscheiden, damit `setValue` keinen
   unnötigen Dirty-Flag triggert.

Das ersetzt die frühere Integration mit der externen Diffchecker-API.
Vorteile: kein Artikelinhalt geht mehr an einen Drittanbieter, der
Redakteur kann pro Absatz entscheiden statt nur all-or-nothing, und
das Modal erscheint genau dann, wenn es etwas zu zeigen gibt.

## Rückgängig (Backup-basiert)

`backup_data` wird einmal pro Lauf vor `lock_editor()` befüllt
(`{ headline, teaser, content, … }`). Der „↺ Rückgängig"-Button
schreibt sämtliche Felder daraus zurück. Bleibt parallel zum
VergleichsWidget als Last-Resort, falls der Redakteur den ganzen
Lauf verwerfen will.

## Link-Vorschau (`wfv4_link_preview`)

Modulares IIFE-internes Submodul. Hängt an alle DOM-Elemente mit
`[data-preview-url]` einen Hover-Listener, der nach 250 ms eine
Karte mit OG-Title / Beschreibung / Bild / Datum öffnet. Vorbefüllt
beim Anhängen (max. 4 Fetches parallel), gecacht in einer
`Map<url, meta>`. Charset wird aus den ersten 2 KB der Response
abgeleitet (winfuture.de liefert teils ISO-8859-1), das Stream-Limit
ist 40 KB pro Page, danach wird `reader.cancel()` aufgerufen. Spart
80–90 % Bandbreite vs. Voll-Download.

Wird im Verlinkungsbereich des Terminals aufgerufen und in
`close_header_btn.onclick` per `destroy()` wieder abgebaut, wenn der
Redakteur das Terminal verbirgt.

## Dunkelmodus

Das Widget folgt dem Tag/Nacht-Schalter der Website. Es ist dunkel,
sobald `<body data-darkmode="on">` gesetzt ist. Der Schalter wirkt
sofort, auch bei offenem Fenster. Die Systemeinstellung
(`prefers-color-scheme`) zählt nicht, wie auf allen Admin-Seiten.

- Jede Farbe in Inline-Stilen und Hover-Handlern lautet
  `var(--kik-<rolle>, <Hellwert>)`.
- Die Variablen setzt nur `<style id="ai-reviewer-styles">`, und nur
  unter `body[data-darkmode="on"]`. Hell gibt es sie nicht, der Browser
  nimmt den Hellwert. Hell bleibt darum Pixel für Pixel gleich.
- Farbige Abzeichen mit weißer Schrift (Prüf-Status, Typ-Chips, ✕,
  Zähler) sehen in beiden Modi gleich aus.
- Die Website färbt dunkel jeden Link per `!important` über
  `--link-color-blue`. Die zwei Links im Widget setzen diese Variable
  darum selbst im Inline-Stil.
- Neue Farben immer als `var(--kik-<rolle>, <Hellwert>)` schreiben.

| Variable | Dunkel | Hell (Rückfall) | Zweck |
|---|---|---|---|
| `--kik-bg` | `#1e1f22` | `#fff` | Fenster, Inhalt, Link-Kästen |
| `--kik-bar` | `#24272b` | `#f8f9fb`, `#fafbfc`, `#f1f3f6` | Kopf, Fuß, Verlinkungen, Bildfläche |
| `--kik-btn`, `--kik-btn-hover` | `#2f3136`, `#3c4043` | `#fff`, `#f1f3f6` | Knöpfe, Vorschaukarte |
| `--kik-line` | `#3c4043` | `#d0d4dc`, `#e5e7eb` | Rahmen, Trennlinien |
| `--kik-btn-line` | `#5f6368` | `#d0d4dc` | Rand von Knöpfen und Vorschaukarte |
| `--kik-text`, `--kik-text2`, `--kik-muted` | `#dfe0e0`, `#b0b3b8`, `#9aa0a6` | `#1f2328`, `#3a3f46`, `#94979d` | Text, Nebentext, Hinweis |
| `--kik-solid`, `--kik-solid-hover` | `#4a4e53`, `#5f6368` | `#1f2328`, `#3a3f46` | Lasche, „Artikel überprüfen“, „Seite neu laden“ |
| `--kik-ok`, `--kik-warn` | `#81c995`, `#f2c26b` | `#176c1f`, `#b45309` | Erfolg, Verarbeitung und Hinweis |
| `--kik-err`, `--kik-err-bg` | `#f0a6a0`, `#4e3f42` | `#a30015`, `#ffe1e1` | Fehler, „Rückgängig machen“ |
| `--kik-accent` | `#6cb4ff` | `#0550ae`, `#2563eb` | Status-Schritte, Links, Linie der Verlinkungen |
| `--kik-save`, `--kik-save-hover` | `#188038`, `#137333` | `#176c1f`, `#125a18` | „Speichern“, „Im Editor prüfen“ |
| `--kik-shadow` | Schwarz 55 % und 40 % | bisheriger Schatten | Fenster, Vorschaukarte |

## Security-Anker

- **§7/§11 Token-Bindung**: HMAC enthält `content_type` und
  `content_id`, damit Token aus einem Artikel nicht auf einen
  anderen wiederverwendbar sind.
- **§12 Keine Details an den Client**: alle Fehlerdetails landen
  ausschließlich im internen Debug-Log (`log_debug`), das per Header-
  Klick „Debug" in die Zwischenablage kopiert wird. Im UI erscheint
  nur eine generische Warnung.
- **§14/§24 XSS**: Roh-Texte vom Backend gehen durch `escape_html()`,
  bevor sie ins `innerHTML` der Korrektur-/Verlinkungsboxen wandern.
- **§19 Ungültige Eingaben abweisen**: `detect_content_info()` lehnt
  unbekannte oder kaputte `wfv4_content`-Globals ab statt zu raten.
- **§20 Minimal Permissions**: keine externen Dependencies, keine
  Drittanbieter-Calls außer dem eigenen Backend.

## Module-State

| Variable | Zweck |
|---|---|
| `terminal_container` | Main-Overlay-DOM |
| `launcher_tab` | Bottom-right-Launcher |
| `poll_active` | True während eines Polling-Laufs |
| `debug_log` | Array von Log-Zeilen (Header-Button „Debug" kopiert sie) |
| `backup_data` | Snapshot vor dem KI-Lauf (für Rückgängig & Diff) |
| `btn_check` | Referenz auf den Start-Button (für Re-Trigger) |
| `content_info` | `{ type, id, config }` aktuell erkannter Content-Typ |
| `vw_load_promise` | Promise-Cache für `ensure_vergleichswidget()` |

## Code-Stil

Folgt der WinFuture-Konvention (siehe [Programmierstil.md](Programmierstil.md)):

- Snake_case für Funktionen und Variablen
- ALL_CAPS für Modul-Konstanten (`PROXY_URL`, `POLLER_URL`, `CONTENT_TYPES`, …)
- Tabs zum Einrücken
- K&R-Klammern, öffnende Klammer auf derselben Zeile
- Spaces innerhalb der Klammern: `if( cond )`, `for( i = 0; …; i++ )`

ISO-8859-1 ist hier **nicht** relevant, der Source ist UTF-8 (Unicode-
Emojis im Code), wird aber als JS-Datei mit `Content-Type: application/javascript`
ohne explizites Charset ausgeliefert. Achte bei Edits darauf, dass
Umlaute im Quelltext UTF-8 bleiben.

## Erweiterungspunkte

- **Neue Content-Types**: in `CONTENT_TYPES` ergänzen, ggf. eintrag
  in `SUBMIT_FUNCTIONS`/`FORM_IDS`. Wenn die ACE-Editor-Instanz nach
  der gleichen Konvention heißt (`<id>_editor`), reicht das.
- **Neue Felder pro Content-Type**: zusätzlichen Feldnamen im
  `fields:`-Objekt anlegen. Headline/Teaser/Content sind aktuell die
  Sektionen, die das VergleichsWidget abbildet — weitere Felder (z. B.
  `software_name` beim Download) werden im Diff-Modal noch ignoriert.
- **Diff-Modal-Optionen**: `VergleichsWidget.open()` akzeptiert
  zusätzlich `defaultMode: 'pseudo' | 'editor'` und
  `defaultOnlyChanges: true | false`. Siehe [vergleichswidget.md](vergleichswidget.md).
