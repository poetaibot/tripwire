# TripWire API Contract v1

Base URL: `https://<host>`
Auth header: `x-api-key: <key>`
Content-Type: `application/json`

## Health
### GET /health
Returns service status + active limits.

## Create Watch
### POST /v1/watches
Create a new watch.

Body:
```json
{
  "type": "http_status | page_change | json_threshold",
  "targetUrl": "https://...",
  "webhookUrl": "https://...",
  "maxLatencyMs": 5000,
  "field": "optional for json_threshold",
  "operator": "gt | lt | eq",
  "threshold": 123
}
```

Responses:
- `201` created `{ watch }`
- `400` invalid payload/url
- `401` unauthorized
- `403` active watch limit reached
- `429` rate limited

## List Watches
### GET /v1/watches
Returns `{ watches: [...] }`

## Watch Events
### GET /v1/watches/:id/events
Returns recent events for watch.

## Pause/Resume Watch
### PATCH /v1/watches/:id
Body:
```json
{ "active": false }
```

## Webhook delivery headers
TripWire sends:
- `x-tripwire-signature` (HMAC-SHA256 of raw body)
- `x-tripwire-watch-id`
- `x-tripwire-attempt`
- `x-tripwire-timestamp`

## Event shape (example)
```json
{
  "id": "...",
  "watchId": "...",
  "eventType": "http_status_alert",
  "createdAt": "2026-03-01T07:38:09.381Z",
  "details": {
    "status": 0,
    "latencyMs": 194,
    "targetUrl": "https://httpstat.us/503"
  },
  "delivery": { "ok": false, "status": 0, "attempts": 3 }
}
```
