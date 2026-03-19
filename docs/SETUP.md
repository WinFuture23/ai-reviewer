# AI-Reviewer: Einbau-Anleitung

## Uebersicht

Der AI-Reviewer ist ein Browser-Widget fuer Redakteure, das Artikel automatisch
auf Rechtschreibung, Grammatik und Verlinkungen pruefen laesst. Er besteht aus:

- **JavaScript-Widget** (geladen via CDN, oeffentlich)
- **PHP-Klasse** (serverseitig, generiert ein Auth-Token)
- **Val.town-Proxy** (leitet Start-Requests an Make.com weiter)
- **Val.town Poller-DB** (SQLite-API, speichert und liefert Job-Ergebnisse)

## Dateien

| Datei | Zweck |
|-------|-------|
| `winfuture-integration.php` | PHP-Klasse `wfv4_ai_reviewer` — einmalig ins Projekt einbinden |

## Schritt 1: Secret ablegen

Das Secret ist ein gemeinsamer HMAC-Schluessel zwischen WinFuture und dem
Val.town-Proxy. Es darf **niemals** im Frontend oder in oeffentlichem Code stehen.

```bash
openssl rand -hex 32
```

Ablageort: Dort, wo andere Secrets/API-Keys auf WinFuture konfiguriert sind.
Beispiele:

```php
// Variante A: Config-Datei / Konstante
define( 'WFV4_AI_REVIEWER_SECRET', '<secret-hier-eintragen>' );

// Variante B: Umgebungsvariable
// WFV4_AI_REVIEWER_SECRET=<secret-hier-eintragen>

// Variante C: Bestehende Config-Klasse
// $config->get( 'ai_reviewer_secret' )
```

## Schritt 2: PHP-Klasse einbinden

Die Datei `winfuture-integration.php` enthaelt die Klasse `wfv4_ai_reviewer`.
Diese Datei muss einmalig ins Projekt eingebunden werden (require/autoload),
passend zur bestehenden Paketstruktur.

## Schritt 3: Aufruf im Editor-Template

An der Stelle, wo der Artikel-Editor gerendert wird, **nur fuer eingeloggte
Redakteure**, folgenden Aufruf einfuegen:

```php
wfv4_ai_reviewer::render( WFV4_AI_REVIEWER_SECRET );
```

Das ist alles. Der Aufruf gibt zwei Script-Tags aus:
1. Ein Inline-Script, das `window.wfv4_ai_reviewer_auth` mit einem
   zeitlich begrenzten HMAC-Token setzt (90 Minuten gueltig)
2. Ein Script-Tag, das das Widget von der CDN-URL laedt

## Was NICHT zu tun ist

- Das Secret **nicht** in PHP-Dateien hardcoden, die ins Repository committed werden
- Den `render()`-Aufruf **nicht** fuer unangemeldete Besucher ausfuehren
- Die CDN-URL **nicht** aendern — sie zeigt auf das aktuelle Release

## Technische Details (fuer Rueckfragen)

- Das Widget erstellt DOM-Elemente mit dem Prefix `ai-reviewer-`
- Es legt genau 2 Variablen auf `window`: `wfv4_ai_reviewer_loaded` und
  `wfv4_ai_reviewer_auth`
- Es liest `window.news_text_editor` (Ace Editor) oder `#news_text` (Fallback)
- Es setzt `window.wfv4_news_changed = true` nach erfolgreicher Aktualisierung
- Keine jQuery-Abhaengigkeit, keine externen CSS-Dateien
