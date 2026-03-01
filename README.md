# TripWire (v1)

TripWire is a lightweight monitoring + webhook alert service.

## v1 watch types
- `http_status` — alert on downtime/high latency
- `page_change` — alert when page content hash changes
- `json_threshold` — alert when numeric JSON field crosses threshold

## Run locally
```bash
cd tripwire
npm start
```

Default settings:
- Port: `8787`
- Poll interval: `60s`
- API key: `tripwire-dev-key`

Set env vars for custom config:
```bash
PORT=8787 POLL_SECONDS=60 USER_API_KEY=your_key ALERT_SECRET=your_secret npm start
```

## API
All `/v1/*` routes require header:
- `x-api-key: <USER_API_KEY>`

### Health
```bash
curl http://localhost:8787/health
```

### Create watch
```bash
curl -X POST http://localhost:8787/v1/watches \
  -H 'content-type: application/json' \
  -H 'x-api-key: tripwire-dev-key' \
  -d '{
    "type":"http_status",
    "targetUrl":"https://example.com",
    "webhookUrl":"https://webhook.site/your-id",
    "maxLatencyMs": 3000
  }'
```

### List watches
```bash
curl http://localhost:8787/v1/watches -H 'x-api-key: tripwire-dev-key'
```

### List events for a watch
```bash
curl http://localhost:8787/v1/watches/<watch_id>/events -H 'x-api-key: tripwire-dev-key'
```

### Pause/resume watch
```bash
curl -X PATCH http://localhost:8787/v1/watches/<watch_id> \
  -H 'content-type: application/json' \
  -H 'x-api-key: tripwire-dev-key' \
  -d '{"active": false}'
```

## Notes
- Webhook payloads include HMAC signature in `x-tripwire-signature`.
- Data is stored in `tripwire/data/db.json` for MVP simplicity.
- Before public launch, add SSRF hardening, quotas, and stronger storage/worker architecture.
