# Spec: velocity-counter

## Purpose

The anti-fraud engine currently has zero velocity tracking. An attacker can probe thousands of cards from one IP or rotate IPs per probe. This spec introduces a velocity counter service that tracks per-BIN, per-IP, per-device, and per-email request rates and emits signals to the fraud engine.

## Requirements

### R1 — Multi-dimensional counters
- `BIN_CARD`: per first-6-digits of PAN, window 1 minute, threshold 10
- `IP_CARD`: per source IP, window 5 minutes, threshold 50
- `DEVICE_CARD`: per device fingerprint, window 5 minutes, threshold 20
- `EMAIL_INTENT`: per user email, window 1 hour, threshold 100
- All counters stored in `VelocityCounters` table (pk: `counter_id = type:value:window`, ttl: window + 1h)

### R2 — Atomic increment
- Single `UpdateCommand` with `UpdateExpression: ADD count :one`
- Returns new count value
- Conditional: skip if window expired (use TTL)

### R3 — Signal emission
- If count exceeds threshold: emit `VELOCITY_EXCEEDED` signal to fraud engine
- Signal weight: 0.6 (per carding-domain taxonomy)
- Signal includes: type, value, current count, threshold

### R4 — User history
- New `UserHistory` table (pk: `user_id`, ttl: 30 days)
- After every BLOCK decision, write user_id with reason + timestamp
- Before evaluating signals, lookup UserHistory for prior BLOCKs
- If found and not expired: auto-BLOCK without signal evaluation

### R5 — Normalize fraud engine formula
- Current: `score = sum(signal_weights)` (causes high FPR)
- New: `score = max(signal_weights)` (any single strong signal triggers BLOCK)
- Threshold: BLOCK ≥ 0.7, REVIEW ≥ 0.4, ALLOW < 0.4
- Per-signal contribution cap: no signal can contribute > 0.5 to score (forces multiple signals to trigger BLOCK)

### R6 — Device fingerprinting
- Frontend integrates `fingerprintjs` (open-source) or `maxmind-device-tracking`
- device_id sent in payment intent headers
- Backend persists device_id per user, tracks changes
- `DEVICE_FINGERPRINT_MISMATCH` signal when device changes within 24h

## Scenarios

### S1 — Card-testing probe
- Attacker sends 50 different PANs from same IP in 5 minutes
- **Expected**: 11th request emits `IP_CARD` VELOCITY_EXCEEDED → BLOCK
- **Closes**: OPL-CARD-001, OPL-CARD-018

### S2 — IP rotation
- Attacker rotates through 1000 proxies, 1 card per IP
- Each IP sees count=1, no velocity signal
- But the same user_id is in all 1000 requests
- **Expected**: `EMAIL_INTENT` threshold (100/hour) triggers BLOCK on 101st request
- **Closes**: OPL-CARD-015

### S3 — Repeat offender
- User blocked on day 1 for TOR_EXIT
- Returns on day 7 with VPN (no TOR)
- Lookup UserHistory: prior BLOCK for this user_id
- **Expected**: Auto-BLOCK without re-evaluating signals
- **Closes**: OPL-CARD-012

### S4 — Legitimate power user
- User makes 30 purchases/day from same device + IP
- Counts: IP=30, DEVICE=30, EMAIL=30
- All below thresholds
- **Expected**: No velocity signal, transaction allowed
- **Closes**: OPL-CARD-001 (false positive avoidance)

### S5 — Device change for legitimate user
- User logs in from new device (new phone)
- 24h after the device change
- **Expected**: Single `DEVICE_FINGERPRINT_MISMATCH` signal (weight 0.4) → REVIEW (not BLOCK)
- **Closes**: OPL-CARD-013

## Out of Scope

- Behavioral biometrics (typing patterns, mouse movement)
- ML-based anomaly detection
- Real-time blacklist sharing with other fintechs
