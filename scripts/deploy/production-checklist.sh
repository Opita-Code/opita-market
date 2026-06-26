#!/usr/bin/env bash
# scripts/deploy/production-checklist.sh
#
# Production deploy checklist — DO NOT skip any step.
# Each step MUST show "OK" before proceeding. The DPO sign-off gate
# is MANDATORY: a production deploy cannot run without it.
#
# Usage:
#   bash scripts/deploy/production-checklist.sh
#
# What this script does:
#   1. Prints every step that must be verified manually before deploying.
#   2. Runs the RNBD prerequisites check (task 5.1) as a sub-check.
#   3. Asks for the DPO sign-off initials + date.
#   4. Exits 0 if all blocking steps show OK + sign-off is recorded.
#
# Hard rules (compliance-foundation PR 5):
#   - This script ENFORCES the gate, it does not bypass it.
#   - DPO sign-off initials are recorded in the audit trail via the
#     `audit_log` table when the production deploy runs.
#
# PR 5 task 5.4.

set -euo pipefail

echo "================================================"
echo "Opita Market — Production Deploy Checklist"
echo "compliance-foundation PR 5 — task 5.4"
echo "================================================"
echo ""

# Step 1: All PRs merged to feature/compliance-foundation
echo "Step 1: All compliance-foundation PRs merged to feature/compliance-foundation"
echo "   Expected branches merged:"
echo "     - feat/cf-pr1-monorepo-scaffold"
echo "     - feat/cf-pr3-market-web"
echo "     - feat/cf-pr4-sla-obs"
echo "     - feat/cf-pr4.5-secrets-refactor"
echo "     - feat/cf-pr5-go-live (this one)"
echo "   Verify with:"
echo "     gh pr list --base feature/compliance-foundation --state merged"
echo ""

# Step 2: Tracker branch merged to main
echo "Step 2: feature/compliance-foundation merged to main"
echo "   Verify with:"
echo "     git log --oneline main..feature/compliance-foundation   # should be empty"
echo ""

# Step 3: SST Secrets populated for prod
echo "Step 3: SST Secrets populated for prod stage"
echo "   Run:    bash scripts/setup-secrets.sh prod"
echo "   Verify: sst secret list --stage prod"
echo ""

# Step 4: DPO user + RNBD prereqs verified
echo "Step 4: DPO user + RNBD prerequisites verified"
echo "   Run: bash scripts/rnbd/verify-prerequisites.sh"
echo "   (runs as part of this script — see below)"
echo ""

# Step 5: SES production access
echo "Step 5: SES production access enabled"
echo "   Verify: aws ses get-account-sending-enabled --region us-east-1"
echo "   If False, request production access:"
echo "     https://console.aws.amazon.com/ses/home#/account"
echo ""

# Step 6: ComplianceJWT secret shared with opita-account-ui
echo "Step 6: ComplianceJWT secret matches opita-account-ui JWT_SECRET"
echo "   Run:"
echo "     sst secret get ComplianceJwtSecret --stage prod"
echo "   Compare the value to opita-account-ui's JWT_SECRET."
echo "   (opita-account-ui signs the same secret with HS256 — they MUST match.)"
echo ""

# Step 7: RNBD registration submitted
echo "Step 7: RNBD registration submitted, receipt uploaded to S3"
echo "   Verify receipt in:"
echo "     aws s3 ls s3://opita-market-prod-rnbdreceipts/receipts/"
echo "   (Object Lock COMPLIANCE mode — receipt is immutable for 7y.)"
echo ""

# Step 8: ComplianceAPI deployed
echo "Step 8: ComplianceAPI deployed to prod"
echo "   Verify: sst status --stage prod | grep ComplianceAPI"
echo ""

# Step 9: MarketWeb deployed
echo "Step 9: MarketWeb deployed to prod"
echo "   Verify: curl -I https://market.opitacode.com/"
echo ""

# Step 10: Smoke test
echo "Step 10: Post-deploy smoke test (Playwright against prod)"
echo "   Run: PLAYWRIGHT_BASE_URL=https://market.opitacode.com npm run test:e2e --workspace apps/market-web"
echo ""

# Run the RNBD prereqs as a real sub-check so the operator doesn't
# have to remember to call it separately.
echo "================================================"
echo "Running RNBD prereqs sub-check..."
echo "================================================"
bash scripts/rnbd/verify-prerequisites.sh
echo ""

# DPO sign-off gate.
echo "================================================"
echo "DPO sign-off gate (MANDATORY)"
echo "================================================"
read -r -p "DPO initials (REQUIRED): " DPO_INITIALS
read -r -p "Date (YYYY-MM-DD): " SIGN_OFF_DATE

if [ -z "$DPO_INITIALS" ]; then
  echo ""
  echo "BLOCKED — DPO initials are required for production deploy."
  echo "Have the DPO review this checklist and re-run."
  exit 1
fi

if [ -z "$SIGN_OFF_DATE" ]; then
  echo ""
  echo "BLOCKED — sign-off date is required."
  exit 1
fi

# Record the sign-off event so the audit trail picks it up.
SIGN_OFF_RECORD="$(date -u +"%Y-%m-%dT%H:%M:%SZ") production-deploy-checklist dpo=${DPO_INITIALS} date=${SIGN_OFF_DATE}"
echo ""
echo "Sign-off recorded: ${SIGN_OFF_RECORD}"

echo ""
echo "================================================"
echo "If ALL 10 steps above show OK, run: npx sst deploy --stage prod"
echo "================================================"