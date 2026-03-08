# AI-Reviewer: KI-Korrektor & Verlinker

Browser-Widget für Redakteure, das Artikel automatisch auf Rechtschreibung, Grammatik und Verlinkungen prüfen lässt.

## Architektur

```
Browser-Widget (ai-reviewer.js)
    ↓ HMAC-authentifiziert
Val.town Proxy
    ↓
Make.com Webhooks (Worker + Poller)
    ↓
KI-Agenten (Korrektor + Verlinker)
```

| Komponente | Beschreibung |
|---|---|
| `ai-reviewer.js` | Frontend-Widget, wird per GitHub Pages ausgeliefert |
| `docs/winfuture-integration.php` | PHP-Klasse zur Auth-Token-Generierung |
| Val.town Proxy | Sicherheits-Proxy, leitet Requests an Make.com weiter |
| Make.com | Orchestriert die KI-Agenten |

## Einbindung

```php
wfv4_ai_reviewer::render( $secret );
```

Gibt zwei Script-Tags aus:
1. Inline-Script mit zeitlich begrenztem HMAC-Token (90 Min gültig)
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
| `AI_REVIEWER_SECRET` | Shared HMAC-Secret |
| `MAKE_WORKER_URL` | Make.com Webhook-URL für den Worker |
| `MAKE_POLLER_URL` | Make.com Webhook-URL für den Poller |
| `SKIP_ORIGIN_CHECK` | `true` nur für Tests, danach löschen |

### 3. PHP-Klasse einbinden

Die Datei `docs/winfuture-integration.php` enthält die Klasse `wfv4_ai_reviewer`.
Im Editor-Template (nur für eingeloggte Redakteure):

```php
wfv4_ai_reviewer::render( WFV4_AI_REVIEWER_SECRET );
```

## Technische Details

- Erstellt DOM-Elemente mit Prefix `ai-reviewer-`
- Window-Variablen: `wfv4_ai_reviewer_loaded`, `wfv4_ai_reviewer_auth`
- Liest `window.news_text_editor` (Ace Editor) oder `#news_text` (Fallback)
- Setzt `window.wfv4_news_changed = true` nach Aktualisierung
- Keine jQuery-Abhängigkeit, keine externen CSS-Dateien

## Dokumentation

| Datei | Inhalt |
|---|---|
| `docs/Programmierstil.md` | WinFuture Coding-Richtlinien |
| `docs/Sicherheitsrichtlinie.md` | WinFuture Sicherheitsrichtlinien |
| `docs/winfuture-integration.php` | PHP-Klasse für die CMS-Integration |
