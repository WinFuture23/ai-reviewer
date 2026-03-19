# Townie Prompt - AI Reviewer Poller-DB

Kopiere den folgenden Prompt in Townie:

---

Erstelle einen einzelnen HTTP Val namens "ai-review-jobs".

## Was der Val tut

Er ist eine einfache REST-API mit SQLite-Datenbank, die als Zwischenspeicher fuer KI-Review-Ergebnisse dient. Make.com schreibt Ergebnisse per POST hinein, das Browser-Widget liest sie per GET aus. Die Authentifizierung erfolgt ueber einen API-Key im Header.

## Umgebungsvariablen (Environment Variables)

Der Val benoetigt eine Umgebungsvariable (bitte als Val.town Environment Variable anlegen, NICHT hardcoden):

- `WINFUTURE_API_KEY` - API-Key fuer Lese- und Schreibzugriff

## Datenbank

Beim ersten Aufruf wird automatisch eine SQLite-Tabelle erstellt (idempotent):

```sql
CREATE TABLE IF NOT EXISTS ai_review_jobs (
    id         INTEGER PRIMARY KEY,
    job_id     TEXT UNIQUE,
    status     TEXT,
    content    TEXT,
    fixes      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## Authentifizierung

Alle Requests (ausser OPTIONS) muessen den Header `x-api-key` enthalten. Der Wert muss mit der Umgebungsvariable `WINFUTURE_API_KEY` uebereinstimmen. Bei fehlendem oder falschem Key: 401 mit `{"error": "Invalid or missing API Key"}`.

## Endpoints

### POST — Ergebnis speichern (von Make.com aufgerufen)

Empfaengt JSON-Body mit:
- `jobId` (String, Pflichtfeld)
- `status` (String, optional)
- `content` (String, optional — der korrigierte Artikeltext)
- `fixes` (String, optional — die Korrekturbeschreibungen)

Logik:
- Upsert: Bei neuem `jobId` einfuegen, bei bestehendem `jobId` aktualisieren
- Nach jedem Insert/Update: Nur die neuesten 100 Eintraege behalten, aeltere loeschen
- Antwort: `{"success": true}`

### GET — Status abfragen (vom Browser-Widget aufgerufen)

Query-Parameter:
- `jobId` (Pflichtfeld)

Logik:
- Suche den Eintrag mit dem gegebenen `jobId`
- Wenn nicht gefunden: `{"status": "pending"}`
- Wenn gefunden: `{"status": "...", "content": "...", "fixes": "..."}`

## CORS

Der Val muss CORS-Headers setzen:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, x-api-key`

Bei OPTIONS-Requests (Preflight): Sofort mit 200 und den CORS-Headers antworten, OHNE Authentifizierung.

## Fehlerbehandlung

- Fehlender `jobId` bei POST: 400 mit `{"error": "jobId is required"}`
- Fehlender `jobId` Query-Parameter bei GET: 400 mit `{"error": "jobId query parameter is required"}`
- Unbekannte HTTP-Methode (nicht GET, POST, OPTIONS): 405 mit `{"error": "Method not allowed"}`
- Interne Fehler: 500 mit `{"error": "Internal server error", "details": "..."}`

## Wichtig

- Kein Rate-Limiting noetig
- Automatisches Cleanup: Maximal 100 Eintraege in der Datenbank
- Alle Responses als JSON zurueckgeben
- Den Val als "HTTP" Val anlegen (nicht als Cron oder Email Val)
- Val.town stellt SQLite ueber `import { sqlite } from "https://esm.town/v/std/sqlite/main.ts"` bereit

---

# Setup-Anleitung

## 1. Umgebungsvariable setzen

Gehe zu https://www.val.town/settings/environment-variables und lege an:

| Variable | Wert |
|----------|------|
| `WINFUTURE_API_KEY` | Ein zufaelliger API-Key-String |

## 2. Val erstellen

- Oeffne Townie (https://www.val.town/townie)
- Kopiere den Prompt von oben hinein
- Townie erstellt den Val
- Notiere die URL des Vals (Format: `https://DEIN-USERNAME--VALNAME.web.val.run`)

## 3. POLLER_URL und POLLER_API_KEY in ai-reviewer.js eintragen

In der Datei `ai-reviewer.js` die entsprechenden Zeilen anpassen:

```js
const POLLER_URL = 'https://DEIN-USERNAME--VALNAME.web.val.run';
const POLLER_API_KEY = '<dein-api-key>';
```

## 4. Make.com konfigurieren

Im Make.com-Szenario muss der letzte Schritt (nach der KI-Verarbeitung) einen POST-Request an die Poller-DB senden:

- URL: Die Val-URL aus Schritt 2
- Header: `x-api-key: <dein-api-key>`
- Body: `{"jobId": "...", "status": "success", "content": "...", "fixes": "..."}`
- Bei Fehlern: `{"jobId": "...", "status": "error", "fixes": "<fehlerbeschreibung>"}`
