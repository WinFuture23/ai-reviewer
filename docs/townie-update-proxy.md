# Townie Prompt — Proxy-API Anpassungen

Kopiere den folgenden Prompt in Townie fuer den bestehenden Val "ai-reviewer-proxy":

---

Bitte nimm folgende Aenderungen am bestehenden Val "ai-reviewer-proxy" vor:

## Aenderung 1: Erweiterter Request-Body

Der POST-Body enthaelt jetzt zusaetzliche Felder neben `action`, `text` und `jobId`. Der Body hat jetzt folgendes Format:

```json
{
    "action": "start",
    "jobId": "wf_job_...",
    "content_type": 6,
    "content_id": 157585,
    "headline": "...",
    "teaser": "...",
    "software_name": "...",
    "content": "...",
    "missing_specials": [
        { "name": "...", "url": "..." }
    ]
}
```

### Validierung der neuen Felder

Vor dem Weiterleiten an Make.com muessen folgende Validierungen durchgefuehrt werden:

1. `content_type` muss vorhanden sein und eine Ganzzahl sein. Erlaubte Werte: `1`, `5`, `6`, `8`. Bei fehlendem oder ungueltigem Wert: 400 mit `{"error": "Invalid content_type"}`.

2. `content_id` muss vorhanden sein und eine Ganzzahl >= 0 sein. Bei fehlendem oder ungueltigem Wert: 400 mit `{"error": "Invalid content_id"}`.

3. `content` (bisher `text`) muss vorhanden sein und ein nicht-leerer String sein. Bei fehlendem oder leerem Wert: 400 mit `{"error": "Content is required"}`.

4. `headline` muss vorhanden sein und ein nicht-leerer String sein. Bei fehlendem oder leerem Wert: 400 mit `{"error": "Headline is required"}`.

5. `teaser`, `software_name` und `missing_specials` sind optional.

6. Maximale Laenge fuer String-Felder:
   - `content`: maximal 500.000 Zeichen
   - `headline`: maximal 500 Zeichen
   - `teaser`: maximal 2.000 Zeichen (wenn vorhanden)
   - `software_name`: maximal 200 Zeichen (wenn vorhanden)
   Bei Ueberschreitung: 400 mit `{"error": "Field too long: <feldname>"}`.

7. `missing_specials` muss, wenn vorhanden, ein Array sein. Jedes Element muss `name` (String) und `url` (String, muss mit `https://winfuture.de/` beginnen) enthalten. Bei ungueltigem Format: 400 mit `{"error": "Invalid missing_specials format"}`.

## Aenderung 2: Weiterleitung an Make.com

Der an Make.com weitergeleitete Body aendert sich. Bisher wurde nur `text` und `jobId` gesendet. Jetzt werden ALLE validierten Felder weitergeleitet:

```json
{
    "jobId": "...",
    "content_type": 6,
    "content_id": 157585,
    "headline": "...",
    "teaser": "...",
    "software_name": "...",
    "content": "...",
    "missing_specials": [...]
}
```

Wichtig: Das Feld `action` wird NICHT an Make.com weitergeleitet (wie bisher). Alle anderen Felder aus dem validierten Body werden 1:1 durchgereicht.

## Aenderung 3: Erweiterte HMAC-Validierung

Die HMAC-Token-Berechnung aendert sich. Der Client sendet jetzt zwei zusaetzliche Header:

- `X-Auth-Ct` — Content-Type-ID (z.B. `"6"`)
- `X-Auth-Cid` — Content-ID (z.B. `"157585"`)

### Neue CORS-Header

Die CORS `Access-Control-Allow-Headers` muessen um die beiden neuen Header ergaenzt werden:

```
Access-Control-Allow-Headers: Content-Type, X-Auth-Token, X-Auth-Ts, X-Auth-Ct, X-Auth-Cid
```

### Neue HMAC-Berechnung

**Bisher** wurde der Token so berechnet:
```
HMAC-SHA256(secret, timestamp)
```

**Neu** wird der Token so berechnet:
```
HMAC-SHA256(secret, "{timestamp}|{content_type}|{content_id}")
```

Die drei Teile werden mit dem Pipe-Zeichen `|` verbunden. Beispiel fuer den HMAC-Payload-String:
```
"1742400000|6|157585"
```

### Validierung (Schritt fuer Schritt)

1. Pruefe ob alle vier Header vorhanden sind: `X-Auth-Token`, `X-Auth-Ts`, `X-Auth-Ct`, `X-Auth-Cid`. Wenn einer fehlt: 403 mit `{"error": "Missing authentication"}`.

2. Pruefe ob `X-Auth-Ct` eine gueltige Content-Type-ID ist (erlaubt: `1`, `5`, `6`, `8`). Wenn ungueltig: 403 mit `{"error": "Invalid authentication"}`.

3. Pruefe ob `X-Auth-Cid` eine Ganzzahl >= 0 ist. Wenn ungueltig: 403 mit `{"error": "Invalid authentication"}`.

4. Pruefe ob der Timestamp nicht aelter als 5400 Sekunden ist (wie bisher).

5. Berechne den erwarteten Token: `HMAC-SHA256(secret, timestamp + "|" + content_type + "|" + content_id)`. Verwende die Werte aus den Headern `X-Auth-Ts`, `X-Auth-Ct` und `X-Auth-Cid`.

6. Vergleiche den berechneten Token mit dem Token aus `X-Auth-Token` (constant-time comparison wie bisher). Wenn nicht identisch: 403 mit `{"error": "Invalid token"}`.

7. **Zusaetzlich**: Pruefe ob `X-Auth-Ct` und `X-Auth-Cid` mit den Werten `content_type` und `content_id` im JSON-Body uebereinstimmen. Wenn nicht: 403 mit `{"error": "Token mismatch"}`. Dies verhindert, dass ein Token fuer Artikel A mit dem Body von Artikel B verwendet wird.

### Bestehende Funktionalitaet beibehalten

- Origin-Check bleibt unveraendert
- `x-make-apikey` Header bleibt unveraendert
- Fehlerbehandlung bleibt unveraendert (403, 405, 502 etc.)

## Zusammenfassung der Aenderungen

1. Erweiterte HMAC-Validierung: Token ist jetzt an content_type und content_id gebunden
2. Zwei neue Request-Header: `X-Auth-Ct`, `X-Auth-Cid`
3. CORS-Header um die beiden neuen Header ergaenzt
4. Token-Body-Abgleich: content_type/content_id aus Header muessen mit Body uebereinstimmen
5. Neue Pflichtfelder im Body validieren: `content_type`, `content_id`, `headline`, `content`
6. Optionale Felder akzeptieren: `teaser`, `software_name`, `missing_specials`
7. Laengen-Limits durchsetzen
8. `missing_specials` URL-Whitelist (`https://winfuture.de/`)
9. Alle validierten Felder (ohne `action`) an Make.com weiterleiten
