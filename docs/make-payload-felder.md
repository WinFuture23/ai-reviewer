# Make.com Payload — Feldübersicht

## Felder die IMMER vorhanden sind

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `action` | String | Immer `"start"` |
| `jobId` | String | Eindeutige Job-ID (Format: `wf_job_{timestamp}_{random}`) |
| `content_type` | Integer | Content-Type-ID (siehe Tabelle unten) |
| `content_id` | Integer | ID des Artikels im CMS (0 bei Testseite) |
| `headline` | String | Überschrift des Artikels |
| `content` | String | Haupttext (HTML) |

## Felder die OPTIONAL vorhanden sind (je nach Content-Type)

| Feld | Typ | Vorhanden bei | Beschreibung |
|------|-----|---------------|-------------|
| `teaser` | String | Nur News (6) | Teaser-/Anrisstext |
| `software_name` | String | Nur Downloads (8) | Name der Software |
| `username` | String | Alle, wenn vorhanden | Login-Name des Redakteurs (max 50 Zeichen) |
| `missing_specials` | Array | Alle, wenn vorhanden | Fehlende Special-Verlinkungen |

## Content-Types

| ID | Name | Pflichtfelder | Optionale Felder |
|----|------|--------------|-----------------|
| 6 | News | headline, content | teaser, missing_specials |
| 8 | Download | headline, content | software_name, missing_specials |
| 5 | Video | headline, content | missing_specials |
| 1 | FAQ | headline, content | missing_specials |

## missing_specials Format

Array von Objekten mit je zwei Feldern:

```json
[
    { "name": "Künstliche Intelligenz", "url": "https://winfuture.de/special/kuenstliche-intelligenz/" },
    { "name": "OpenAI", "url": "https://winfuture.de/special/openai/" }
]
```

## Spätere Erweiterungen (TODO)

- `tags` — Element-ID im CMS noch unbekannt
- `screenshot_content` — noch nicht implementiert
- `screenshot_all` — noch nicht implementiert

## Erwartete Antwort (über Poller-DB)

Die KI-Agenten schreiben das Ergebnis in die Poller-DB. Das Widget liest folgende Felder:

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `status` | String | `"pending"`, `"success"` oder `"error"` |
| `content` | String | Korrigierter Haupttext (Pflicht bei success) |
| `headline` | String | Korrigierte Überschrift (optional, wird nur zurückgeschrieben wenn vorhanden) |
| `teaser` | String | Korrigierter Teaser (optional, wird nur zurückgeschrieben wenn vorhanden) |
| `fixes` | String | Korrekturbeschreibungen mit `<korrektor>` und `<verlinker>` Tags |
