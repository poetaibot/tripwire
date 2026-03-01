# TripWire Synthetic Beta Plan

## Goal
Validate reliability and cost behavior without external testers.

## Duration
- Initial run: ~7 minutes (`ROUNDS=6`, `SLEEP_SECS=65`)
- Extended run: 2-4 hours (increase rounds)

## Traffic mix
1. Stable watch (`example.com`) → should stay quiet.
2. Failure watch (`httpstat.us/503` + failing webhook) → retries + dedupe behavior.
3. Threshold watch (`worldtimeapi` unixtime) → threshold trigger path.

## Success checks
- Service remains up
- No uncontrolled event spam
- Retry cap enforced (max 3)
- Dedupe suppresses repeated failures inside window
- Cleanup pauses created watches

## Run command
```bash
cd /home/claw/.openclaw/workspace/tripwire
API_KEY=<tripwire_api_key> bash scripts/synthetic-beta.sh
```

## Artifacts
- Logs saved to `tripwire/logs/synthetic-beta-*.log`
