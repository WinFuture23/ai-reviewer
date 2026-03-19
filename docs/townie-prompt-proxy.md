# Townie Prompt - AI Reviewer Proxy

Kopiere den folgenden Prompt in Townie:

---

Erstelle einen einzelnen HTTP Val namens "ai-reviewer-proxy".

## Was der Val tut

Er ist ein Sicherheits-Proxy, der Start-Requests von einem Browser-Widget entgegennimmt, per HMAC-Token authentifiziert und an den Make.com-Worker-Webhook weiterleitet. Die echte Webhook-URL soll nie im Client-Code stehen. Das Polling laeuft ueber einen separaten Val (Poller-DB) und ist NICHT Teil dieses Proxys.

## Umgebungsvariablen (Environment Variables)

Der Val benoetigt drei Umgebungsvariablen (bitte als Val.town Environment Variables anlegen, NICHT hardcoden):

- `AI_REVIEWER_SECRET` - Der geheime HMAC-Schluessel (identisch mit dem auf dem Server, der die Tokens generiert)
- `MAKE_WORKER_URL` - Die Make.com-Webhook-URL fuer den Worker
- `MAKE_WORKER_APIKEY` - API-Key fuer die Authentifizierung gegenueber Make.com

## Request-Format

Der Val empfaengt POST-Requests mit JSON-Body. Jeder Request hat:

### Headers:
- `Content-Type: application/json`
- `X-Auth-Token` - HMAC-SHA256-Hash (hex) des Timestamps, berechnet mit dem shared secret
- `X-Auth-Ts` - Unix-Timestamp (Sekunden) als String

### Body (JSON):
- `action` - Immer `"start"`
- `text` (String, der Artikeltext)
- `jobId` (String)

## Validierungs-Logik

Bei jedem Request:

1. Pruefe ob `X-Auth-Token` und `X-Auth-Ts` Header vorhanden sind. Wenn nicht: 403 mit `{"error": "Missing authentication"}`.

2. Pruefe ob der Timestamp nicht aelter als 5400 Sekunden (90 Minuten) ist. Vergleiche `X-Auth-Ts` mit der aktuellen Serverzeit (Absolutwert der Differenz). Wenn abgelaufen: 403 mit `{"error": "Token expired"}`.

3. Berechne den erwarteten Token: `HMAC-SHA256(secret, timestamp)` wobei `secret` die Umgebungsvariable `AI_REVIEWER_SECRET` ist und `timestamp` der Wert aus `X-Auth-Ts`. Verwende die Web Crypto API (`crypto.subtle.importKey` und `crypto.subtle.sign` mit HMAC/SHA-256). Der Token muss als Hex-String verglichen werden. Wenn er nicht uebereinstimmt: 403 mit `{"error": "Invalid token"}`.

4. Pruefe ob der `Origin`-Header auf `.winfuture.de` endet (case-insensitive). Wenn kein Origin-Header vorhanden ist oder er nicht passt: 403 mit `{"error": "Origin not allowed"}`. WICHTIG: Fuer Testzwecke soll der Origin-Check uebersprungen werden, wenn die Umgebungsvariable `SKIP_ORIGIN_CHECK` auf `"true"` gesetzt ist.

## Weiterleitungs-Logik

Nach erfolgreicher Validierung, wenn `action` gleich `"start"`:

- Mache einen POST-Request an die URL aus `MAKE_WORKER_URL`
- Content-Type: `application/json`
- Header: `x-make-apikey` mit dem Wert aus `MAKE_WORKER_APIKEY`
- Body: `{"text": "<der text aus dem request>", "jobId": "<die jobId aus dem request>"}`
- Gib die Antwort von Make.com direkt zurueck (Status-Code und Body durchreichen)
- Bei unbekannter `action`: 400 mit `{"error": "Invalid action"}`

## CORS

Der Val muss CORS-Headers setzen:
- `Access-Control-Allow-Origin: *` (wird spaeter auf die Domain eingeschraenkt)
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, X-Auth-Token, X-Auth-Ts`

Bei OPTIONS-Requests (Preflight): Sofort mit 204 und den CORS-Headers antworten.

## Fehlerbehandlung

- Wenn Make.com nicht erreichbar ist oder einen Fehler zurueckgibt: Gib Status 502 mit `{"error": "Upstream error"}` zurueck. Gib KEINE Details aus Make.com an den Client weiter.
- Nur POST-Requests werden unterstuetzt. Andere Methoden (ausser OPTIONS): 405 mit `{"error": "Method not allowed"}`.
- Wenn die `action` nicht `"start"` ist: 400 mit `{"error": "Invalid action"}`.
- Wenn der JSON-Body nicht geparsed werden kann: 400 mit `{"error": "Invalid request body"}`.

## Wichtig

- Kein Rate-Limiting noetig
- Kein Logging oder State-Speicherung noetig
- Die Make.com-URLs duerfen NIEMALS in einer Response an den Client erscheinen
- Alle Fehler-Responses als JSON zurueckgeben
- Den Val als "HTTP" Val anlegen (nicht als Cron oder Email Val)

---

# Setup-Anleitung

## 1. Val.town Account

Falls noch nicht vorhanden: Registriere dich auf https://www.val.town/

## 2. Umgebungsvariablen setzen

Gehe zu https://www.val.town/settings/environment-variables und lege an:

| Variable | Wert |
|----------|------|
| `AI_REVIEWER_SECRET` | Ein zufaelliger String, mind. 32 Zeichen. Beispiel generieren: `openssl rand -hex 32` im Terminal |
| `MAKE_WORKER_URL` | Die Make.com-Webhook-URL fuer den Worker |
| `MAKE_WORKER_APIKEY` | API-Key fuer Make.com (wird als `x-make-apikey` Header mitgesendet) |
| `SKIP_ORIGIN_CHECK` | `true` (fuer Tests, spaeter auf `false` setzen oder Variable loeschen) |

## 3. Val erstellen

- Oeffne Townie (https://www.val.town/townie)
- Kopiere den Prompt von oben hinein
- Townie erstellt den Val
- Notiere die URL des Vals (Format: `https://DEIN-USERNAME-ai-reviewer-proxy.web.val.run`)

## 4. PROXY_URL in ai-reviewer.js eintragen

In der Datei `ai-reviewer.js` die Zeile mit `PROXY_URL` anpassen:

```js
const PROXY_URL = 'https://DEIN-USERNAME-ai-reviewer-proxy.web.val.run';
```

## 5. Secret auf WinFuture eintragen

Dasselbe Secret wie in Schritt 2 in der WinFuture-PHP-Konfiguration eintragen.
Siehe `docs/winfuture-integration.php` fuer das PHP-Beispiel.

## 6. Testen

1. `SKIP_ORIGIN_CHECK` auf `true` lassen
2. Die PHP-Integration auf WinFuture einbinden
3. Im Browser testen: Artikel ueberpruefen klicken
4. Debug-Log pruefen (im Widget: "Debug kopieren")
5. Wenn alles funktioniert: `SKIP_ORIGIN_CHECK` auf `false` setzen oder loeschen
