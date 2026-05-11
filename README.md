# KI-Korrektor

Browser-Widget für die WinFuture-Redaktion. Lässt Artikel durch eine
KI-Pipeline auf Rechtschreibung, Grammatik und passende interne
Verlinkungen prüfen und zeigt das Ergebnis in einem schwebenden
Overlay-Panel direkt im CMS-Editor an. Inklusive einem Vorher/Nachher-
Diff-Modal, mit dem der Redakteur die KI-Vorschläge absatzweise
annehmen oder verwerfen kann. Beide Komponenten teilen denselben
hellen, system-nativen Look (System-Sans-Serif, dezente Border und
Akzent-Palette).

## Module

Das Projekt besteht aus zwei eigenständigen JavaScript-Dateien, die
nebeneinander auf GitHub Pages ausgeliefert werden:

| Datei | Zweck | Größe | Details |
|---|---|---|---|
| [`ai-reviewer.js`](ai-reviewer.js) | Haupt-Widget. Erkennt den Content-Type, liest die Editor-Felder, schickt sie an den Backend-Worker, pollt das Ergebnis, schreibt es zurück und rendert Korrekturen + Verlinkungsvorschläge. | ~80 KB | [`docs/ai-reviewer.md`](docs/ai-reviewer.md) |
| [`vergleichswidget.js`](vergleichswidget.js) | Lazy nachgeladener Vorher/Nachher-Diff. Drei Sektionen (Headline / Teaser / Body), pro Absatz eine Accept-/Reject-Entscheidung, byte-exakte Erhaltung von HTML- und `##`-Shortcode-Markup. | ~73 KB | [`docs/vergleichswidget.md`](docs/vergleichswidget.md) |

`ai-reviewer.js` lädt `vergleichswidget.js` erst beim ersten Klick auf
„🔍 Unterschiede anzeigen" nach. Die URL wird aus dem eigenen
`<script src>` abgeleitet, beide Dateien liegen also auf derselben
Origin (Production: `https://winfuture23.github.io/ai-reviewer/`).

## Architektur

```
Browser (CMS-Editor)
  └─ ai-reviewer.js (per <script> aus GitHub Pages)
       ├─ Start-Request (HMAC-Token, content_type, content_id)
       │       ↓
       │   Val.town Proxy  ─▶  Make.com Worker  ─▶  KI-Agenten
       │                                                ↓
       │                                          Val.town Poller-DB (SQLite)
       │                                                ↑
       └─ Poll-Request (API-Key) ──────────────────────┘

       beim Klick auf „Unterschiede anzeigen":
       └─ vergleichswidget.js (nachgeladen, gleicher Origin)
            └─ onResolve(resolved) ─▶  Editor-Felder werden absatzweise
                                       byte-exakt aktualisiert
```

| Komponente | Beschreibung |
|---|---|
| `ai-reviewer.js` | Frontend-Widget, GitHub Pages |
| `vergleichswidget.js` | Frontend-Diff-Modal, GitHub Pages |
| [`docs/winfuture-integration.php`](docs/winfuture-integration.php) | PHP-Klasse `wfv4_ai_reviewer::render()` für die Auth-Token-Generierung im CMS |
| Val.town Proxy | Leitet HMAC-authentifizierte Start-Requests an Make.com weiter |
| Val.town Poller-DB | SQLite-API, in der Make.com das KI-Ergebnis ablegt und das Widget es abholt |
| Make.com Worker | Orchestriert die KI-Agenten (Korrektor + Verlinker) |

## Unterstützte Content-Types

| ID | Typ | Felder |
|---|---|---|
| 6 | News | Headline, Teaser, Content |
| 8 | Download | Headline, Software-Name, Content |
| 5 | Video | Headline, Content |
| 1 | FAQ | Headline, Content |

Erkennung über `window.wfv4_content = { type: 6, id: 157585 }`, das
das CMS auf der Editorseite setzt. Fallback: wenn ein `#news_text`
DOM-Element existiert, nimmt das Widget News an.

## Einbindung im CMS

In einem Editor-Template, nur für eingeloggte Redakteure:

```php
wfv4_ai_reviewer::render( WFV4_AI_REVIEWER_SECRET, $content_type, $content_id );
```

Das gibt zwei `<script>`-Tags aus:

1. Inline-Script, das `window.wfv4_ai_reviewer_auth` mit einem
   HMAC-SHA256-Token belegt, gebunden an Timestamp + Content-Type +
   Content-ID (90 Minuten gültig).
2. Script-Tag, das `ai-reviewer.js` von GitHub Pages lädt.

Setup im Detail: [`docs/SETUP.md`](docs/SETUP.md).

## Deployment

GitHub Pages serviert beide JS-Dateien aus dem Repo-Root. Der Workflow
([`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml))
triggert bei jedem Push auf `main`, der eine der beiden Dateien ändert,
und kopiert genau diese beiden Dateien (sonst nichts) in das deployte
`_site/`-Verzeichnis:

```
https://winfuture23.github.io/ai-reviewer/ai-reviewer.js
https://winfuture23.github.io/ai-reviewer/vergleichswidget.js
```

Alles andere (`docs/`, `gfx/`, `README.md`) ist im Repo, wird aber
**nicht** ausgeliefert.

## Setup (Ersteinrichtung)

### 1. Shared Secret generieren

```bash
openssl rand -hex 32
```

Wird benötigt in:

- **Val.town Proxy** → Umgebungsvariable `AI_REVIEWER_SECRET`
- **WinFuture PHP** → z. B. `define( 'WFV4_AI_REVIEWER_SECRET', '...' );`

### 2. Val.town Proxy einrichten

Umgebungsvariablen auf [val.town](https://www.val.town/settings/environment-variables):

| Variable | Beschreibung |
|---|---|
| `AI_REVIEWER_SECRET` | Shared HMAC-Secret für den Proxy |
| `MAKE_WORKER_URL` | Make.com-Webhook-URL |
| `MAKE_WORKER_APIKEY` | API-Key für Make.com (`x-make-apikey` Header) |
| `SKIP_ORIGIN_CHECK` | `true` nur für Tests, danach löschen |

### 3. Val.town Poller-DB einrichten

| Variable | Beschreibung |
|---|---|
| `WINFUTURE_API_KEY` | API-Key für Lese-/Schreibzugriff auf die Job-DB |

### 4. PHP-Klasse einbinden

`docs/winfuture-integration.php` enthält `wfv4_ai_reviewer`. Im
Editor-Template:

```php
wfv4_ai_reviewer::render( WFV4_AI_REVIEWER_SECRET, $content_type, $content_id );
```

## Dateien

```
KI Korrektor/
├── ai-reviewer.js           Haupt-Widget
├── vergleichswidget.js      Lazy nachgeladenes Diff-Modal
├── README.md                Diese Datei
├── .github/workflows/       Pages-Deploy-Workflow
├── docs/
│   ├── ai-reviewer.md           Detail-Doku zum Haupt-Widget
│   ├── vergleichswidget.md      Detail-Doku zum Diff-Modal
│   ├── vergleichswidget-demo.html  Standalone-Demo des Diff-Modals
│   ├── SETUP.md                 PHP-Setup-Anleitung
│   ├── Programmierstil.md       WinFuture Coding-Richtlinien
│   ├── Sicherheitsrichtlinie.md WinFuture Sicherheitsrichtlinien
│   ├── winfuture-integration.php  PHP-Klasse fürs CMS
│   ├── townie-prompt-proxy.md   Townie-Prompt für Val.town Proxy
│   ├── townie-prompt-poller-db.md  Townie-Prompt für Poller-DB
│   ├── townie-update-proxy.md   Update-Prompt für Proxy (v3)
│   ├── townie-update-poller-db.md  Update-Prompt für Poller-DB (v3)
│   ├── make-payload-felder.md   Feldübersicht für Make.com-Payload
│   ├── make-example-payload.json   Beispiel-JSON für Make.com
│   └── test.html                manuelle Test-Seite
└── gfx/                     Screenshots
```

## Lokal entwickeln

Das VergleichsWidget hat eine Standalone-Demo:

```bash
cd "/Users/mesios/Downloads/_Code/KI Korrektor"
python3 -m http.server 8765
# → http://localhost:8765/docs/vergleichswidget-demo.html
```

Das CMS-Widget (`ai-reviewer.js`) lässt sich nicht trivial lokal
testen, weil es einen `wfv4uid`-Cookie, ACE-Editor-Instanzen
(`window.<feldname>_editor`), das Backend-Auth-Token und einen
laufenden Val.town-Proxy + Poller voraussetzt. Tests laufen direkt
im CMS-Editor gegen die produktiven Endpoints.

## Kontakt / Eigentum

Interne WinFuture-Komponente. Kontakt: **Sebastian Kuhbach** —
Telegram [@wf_sebastian](https://t.me/wf_sebastian) ·
Email [sk@winfuture.de](mailto:sk@winfuture.de)
