# TripWire Private Beta Checklist

## 1) Security (must pass)
- [x] SSRF protections: block localhost/private/meta targets
- [x] API key required on all `/v1/*` routes
- [x] Rate limiting active
- [ ] API key rotation flow documented
- [ ] Optional IP allowlist for admin routes

## 2) Reliability (must pass)
- [x] Poll floor enforced (>=60s)
- [x] Webhook retries with backoff and cap
- [x] Event dedupe window active
- [ ] Delivery success SLO defined and measured over 24h run
- [ ] Basic status page/report format

## 3) Abuse controls (must pass)
- [x] Active watch cap per key
- [x] Payload/body size limit
- [ ] Per-day quota counters per API key
- [ ] Auto-pause key on repeated abuse

## 4) Data + operations
- [ ] Retention window for events/logs (e.g. 7-14 days)
- [ ] Incident playbook (what to do when delivery fails)
- [ ] Global kill switch documented and tested

## 5) Go-public gates
- [ ] 24h soak test with no crashes
- [ ] >=95% delivery success (test targets)
- [ ] Dedupe and retry behavior verified in logs
- [ ] Clear beta disclaimer + support contact

