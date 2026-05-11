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

Das Widget startet nur, wenn beide Bedingungen erfüllt sind:

1. Der Cookie `wfv4uid` ist eine der freigegebenen User-IDs
   (`ALLOWED_USERS` im Source — aktuell Sebastian Kuhbach,
   Witold Pryjda, Felix Krauth).
2. Das CMS hat den Script-Tag ausgegeben — d. h. die PHP-Klasse
   `wfv4_ai_reviewer::render()` wurde aufgerufen (siehe
   [winfuture-integration.php](winfuture-integration.php)).

Schlägt eine der beiden Prüfungen fehl, returnt die IIFE silent, ohne
DOM-Elemente anzulegen. Doppelt-Eingebundene Scripts werden über das
Flag `window.wfv4_ai_reviewer_loaded` abgefangen.

## Lebenszyklus

```
[Page Load]
  └─ IIFE prüft Cookie + Loaded-Flag → exit oder weiter
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

Timeout: 15 Minuten. Nach Ablauf wird ein letzter Poll versucht,
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
