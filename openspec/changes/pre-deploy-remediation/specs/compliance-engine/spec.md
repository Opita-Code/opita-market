# Spec: compliance-engine

## Purpose

UIAF monitor is a stub that throws "not implemented". No PEP or sanctions screening exists. The current code cannot comply with Colombian anti-money-laundering law (Decreto 222/2020, UIAF regulations) for a closed-loop wallet. This spec wires up the UIAF cron, adds PEP + sanctions screening via external service, and implements SAR filing.

## Requirements

### R1 — UIAF cron wired to EventBridge
- Hourly schedule invokes `UiafMonitor.run()` Lambda
- Scans transactions in last hour
- Detects: amount > 5M COP (cash equivalent) OR amount > 10M COP (non-cash: PSE/Nequi/Daviplata)
- Emits SAR if threshold exceeded
- Uses DynamoDB GSI `TimeAmountIndex` for efficient scan

### R2 — SAR filing to UIAF
- Generates UIAF-formatted XML/JSON
- Submits via UIAF API (when available) or queues for manual filing
- Stores SAR record in `UiafReports` table (immutable, 5-year retention)
- Logs SAR ID + timestamp for audit

### R3 — Structuring detection
- Flags users with 5+ transactions of 900k-1M COP in 24h
- Emits STRUCTURING_SUSPECTED signal (weight 0.8)
- Triggers manual DPO review

### R4 — PEP screening
- Onboarding: new user screened against PEP list (ComplyAdvantage or equivalent)
- Periodic re-screening: monthly for all Tier 2+ users
- Match → enhanced due diligence (manual DPO review)
- No service for v1: document as third-party integration in PR 4

### R5 — Sanctions screening
- Every user screened against OFAC SDN, UN Security Council, EU Consolidated List
- Every transaction > 1M COP screened for counterparty
- Match → transaction BLOCKED, user suspended, manual review
- No service for v1: document as third-party integration in PR 4

### R6 — SIC registration
- Closed-loop wallet registration under Decreto 222/2020 Art. 3
- Operator obtains certificate from SIC, stores in S3 WORM bucket
- Documented in RUNBOOK.md
- Cannot be automated (regulatory process)

## Scenarios

### S1 — Single high-value transaction
- User makes 6,000,000 COP card payment
- UIAF cron detects threshold exceeded
- SAR generated and filed
- DPO email alert
- **Closes**: OPL-COMP-014, OPL-COMP-015

### S2 — Structuring pattern
- User makes 10 transactions of 950,000 COP in 1 day
- UIAF cron detects pattern
- STRUCTURING_SUSPECTED signal emitted
- DPO manual review triggered
- **Closes**: OPL-COMP-016

### S3 — Non-cash threshold
- User makes 12,000,000 COP Nequi payment
- UIAF cron detects (10M threshold for non-cash)
- SAR generated
- **Closes**: OPL-COMP-017

### S4 — Sanctioned counterparty
- Transaction > 1M COP attempted to merchant in OFAC list
- Sanctions screening match
- Transaction BLOCKED, user notified, DPO alerted
- **Closes**: OPL-COMP-019

### S5 — PEP user detected
- New user matches PEP list at onboarding
- Enhanced due diligence triggered
- Account held in pending state until DPO approves
- **Closes**: OPL-COMP-018

## Out of Scope

- Real-time UIAF API integration (queue for manual)
- PEP list curation (use third-party provider)
- Transaction monitoring for crypto (out of product scope)
- International tax reporting (FATCA, CRS)
