# Townie Prompt — Poller-DB Anpassungen

Kopiere den folgenden Prompt in Townie fuer den bestehenden Val "ai-review-jobs":

---

Bitte nimm folgende Aenderungen am bestehenden Val "ai-review-jobs" vor:

## Aenderung 1: Erweiterte Datenbank-Tabelle

Die SQLite-Tabelle `ai_review_jobs` benoetigt zwei neue optionale Spalten. Bitte fuege sie hinzu (abwaertskompatibel, bestehende Daten bleiben erhalten):

```sql
ALTER TABLE ai_review_jobs ADD COLUMN headline TEXT;
ALTER TABLE ai_review_jobs ADD COLUMN teaser TEXT;
```

Fuehre die ALTER TABLE Befehle beim Start aus, aber fange den Fehler ab falls die Spalten bereits existieren (idempotent, z.B. mit try/catch).

## Aenderung 2: POST-Endpoint erweitern

Der POST-Body kann jetzt zwei zusaetzliche optionale Felder enthalten:

- `headline` (String, optional — die korrigierte Ueberschrift)
- `teaser` (String, optional — der korrigierte Teaser)

Diese Felder sollen beim Upsert genauso behandelt werden wie `content` und `fixes`:
- Bei neuem `jobId`: alle vorhandenen Felder einfuegen
- Bei bestehendem `jobId`: alle vorhandenen Felder aktualisieren

Das INSERT/UPDATE Statement muss die neuen Spalten beruecksichtigen:

```sql
INSERT INTO ai_review_jobs (job_id, status, content, fixes, headline, teaser)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(job_id) DO UPDATE SET
    status = COALESCE(excluded.status, status),
    content = COALESCE(excluded.content, content),
    fixes = COALESCE(excluded.fixes, fixes),
    headline = COALESCE(excluded.headline, headline),
    teaser = COALESCE(excluded.teaser, teaser)
```

## Aenderung 3: GET-Endpoint erweitern

Die GET-Response soll die neuen Felder zurueckgeben, wenn sie in der Datenbank vorhanden sind:

Wenn gefunden:
```json
{
    "status": "success",
    "content": "...",
    "fixes": "...",
    "headline": "...",
    "teaser": "..."
}
```

`headline` und `teaser` sollen nur in der Response enthalten sein, wenn sie nicht null sind. Beispiel: Wenn kein `headline` gespeichert wurde, soll das Feld in der JSON-Response fehlen (nicht als `null` zurueckgeben).

## Aenderung 4: Bestehende Funktionalitaet beibehalten

- Authentifizierung ueber `x-api-key` Header bleibt unveraendert
- Cleanup-Logik (max 100 Eintraege) bleibt unveraendert
- CORS-Headers bleiben unveraendert
- Fehlerbehandlung bleibt unveraendert
- `status`, `content`, `fixes` funktionieren wie bisher

## Zusammenfassung der Aenderungen

1. Zwei neue Spalten: `headline` und `teaser` (ALTER TABLE, idempotent)
2. POST: Neue optionale Felder `headline` und `teaser` beim Upsert beruecksichtigen
3. GET: Neue Felder in der Response zurueckgeben (nur wenn nicht null)
4. Alles abwaertskompatibel — bestehende Eintraege ohne die neuen Felder funktionieren weiterhin
