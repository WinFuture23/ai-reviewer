# AI-Reviewer: KI-Korrektor & Verlinker

Browser-Widget für Redakteure, das Artikel automatisch auf Rechtschreibung, Grammatik und Verlinkungen prüfen lässt.

## Architektur

```
Browser-Widget (ai-reviewer.js)
    ├─ Start-Request (HMAC-authentifiziert)
    │       ↓
    │   Val.town Proxy → Make.com Worker → KI-Agenten
    │                                          ↓
    │                                    Val.town Poller-DB (SQLite)
    │                                          ↑
    └─ Poll-Request (API-Key) ────────────────┘
```

| Komponente | Beschreibung |
|---|---|
| `ai-reviewer.js` | Frontend-Widget, wird per GitHub Pages ausgeliefert |
| `docs/winfuture-integration.php` | PHP-Klasse zur Auth-Token-Generierung |
| Val.town Proxy | Sicherheits-Proxy, leitet Start-Requests an Make.com weiter |
| Val.town Poller-DB | SQLite-basierte API, speichert und liefert Job-Ergebnisse |
| Make.com Worker | Orchestriert die KI-Agenten, schreibt Ergebnis in Poller-DB |

## Unterstützte Content-Types

| ID | Typ | Felder |
|---|---|---|
| 6 | News | Headline, Teaser, Content |
| 8 | Download | Headline, Software-Name, Content |
| 5 | Video | Headline, Content |
| 1 | FAQ | Headline, Content |

Erkennung via `window.wfv4_content = { type: 6, id: 157585 }` (vom CMS gesetzt).

## Einbindung

```php
wfv4_ai_reviewer::render( $secret, $content_type, $content_id );
```

Gibt zwei Script-Tags aus:
1. Inline-Script mit HMAC-Token gebunden an Content-Type und Content-ID (90 Min gültig)
2. Script-Tag, das das Widget von GitHub Pages lädt

## Deployment

Das Widget wird automatisch über **GitHub Pages** ausgeliefert:

```
https://winfuture23.github.io/ai-reviewer/ai-reviewer.js
```

Bei jedem Push auf `main`, der `ai-reviewer.js` ändert, wird automatisch deployed.
Nur `ai-reviewer.js` ist über Pages erreichbar — keine anderen Dateien.

## Setup (Ersteinrichtung)

### 1. Shared Secret generieren

```bash
openssl rand -hex 32
```

Das Secret wird benötigt in:
- **Val.town** → Umgebungsvariable `AI_REVIEWER_SECRET`
- **WinFuture PHP** → Konfiguration (z.B. `define('WFV4_AI_REVIEWER_SECRET', '...')`)

### 2. Val.town Proxy einrichten

Umgebungsvariablen auf [val.town](https://www.val.town/settings/environment-variables) setzen:

| Variable | Beschreibung |
|---|---|
| `AI_REVIEWER_SECRET` | Shared HMAC-Secret (für den Proxy) |
| `MAKE_WORKER_URL` | Make.com Webhook-URL für den Worker |
| `MAKE_WORKER_APIKEY` | API-Key für Make.com (wird als `x-make-apikey` Header mitgesendet) |
| `SKIP_ORIGIN_CHECK` | `true` nur für Tests, danach löschen |

### 3. Val.town Poller-DB einrichten

| Variable | Beschreibung |
|---|---|
| `WINFUTURE_API_KEY` | API-Key für Lese-/Schreibzugriff auf die Job-Datenbank |

### 4. PHP-Klasse einbinden

Die Datei `docs/winfuture-integration.php` enthält die Klasse `wfv4_ai_reviewer`.
Im Editor-Template (nur für eingeloggte Redakteure):

```php
wfv4_ai_reviewer::render( WFV4_AI_REVIEWER_SECRET, $content_type, $content_id );
```

## Technische Details

- Erstellt DOM-Elemente mit Prefix `ai-reviewer-`
- Window-Variablen: `wfv4_ai_reviewer_loaded`, `wfv4_ai_reviewer_auth`, `wfv4_content`
- Erkennt Content-Type über `window.wfv4_content` und liest Felder aus ACE-Editoren
- HMAC-Token gebunden an Timestamp, Content-Type und Content-ID
- Setzt `window.wfv4_news_changed = true` nach Aktualisierung
- Keine jQuery-Abhängigkeit, keine externen CSS-Dateien

## Dokumentation

| Datei | Inhalt |
|---|---|
| `docs/Programmierstil.md` | WinFuture Coding-Richtlinien |
| `docs/Sicherheitsrichtlinie.md` | WinFuture Sicherheitsrichtlinien |
| `docs/winfuture-integration.php` | PHP-Klasse für die CMS-Integration |
| `docs/townie-prompt-proxy.md` | Townie-Prompt für den Val.town Proxy |
| `docs/townie-prompt-poller-db.md` | Townie-Prompt für die Val.town Poller-DB |
| `docs/townie-update-proxy.md` | Townie-Prompt für Proxy-Erweiterungen (v3) |
| `docs/townie-update-poller-db.md` | Townie-Prompt für Poller-DB-Erweiterungen (v3) |
| `docs/make-payload-felder.md` | Feldübersicht für Make.com Payload |
| `docs/make-example-payload.json` | Beispiel-JSON für Make.com |
