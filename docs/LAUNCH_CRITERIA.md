# TripWire Launch Criteria (Private Beta -> Public)

## Private beta entry (minimum)
- Core security checks pass (SSRF, auth, rate limits)
- Retry + dedupe validated
- Poll floor and watch cap enforced

## Public listing allowed only when ALL are true
1. 24-hour soak test complete with no service crashes
2. Delivery success >= 95% on healthy webhook targets
3. Median alert latency <= 15s after poll detection
4. Abuse protections verified in logs (rate-limit and blocked URL attempts)
5. Beta docs published (API contract, known limits, support path)

## Immediate rollback triggers
- Repeated delivery failures > 20% for 10+ minutes
- Elevated error spikes or process restarts
- Security anomaly (unexpected internal target attempts bypassing checks)

## Operating policy
- Prefer reliability over feature expansion.
- Pause public traffic before trust is damaged.
