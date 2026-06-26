#!/usr/bin/env bash
# scripts/rnbd/verify-prerequisites.sh
#
# Verify operator has everything needed to submit RNBD registration
# BEFORE they sit down at the SIC portal.
#
# This script is INTENTIONALLY a checker, not an automation: the RNBD
# portal requires an operator's certificado digital + a manual submission
# (legal act under Ley 1581/2012). What we CAN do here is fail fast on
# the prereqs so the operator doesn't waste time at the portal.
#
# Usage:
#   bash scripts/rnbd/verify-prerequisites.sh
#
# Exit codes:
#   0 — all blocking checks pass (warnings may still be present)
#   1 — at least one blocking check failed
#
# Compliance-foundation PR 5 — task 5.1.
# Related tasks: 5.2 (form payload gen), 5.3 (S3 Object Lock receipt).

set -euo pipefail

echo "================================================"
echo "RNBD Submission Prerequisites Check"
echo "compliance-foundation PR 5 — task 5.1"
echo "================================================"
echo ""

ERRORS=0

# 1. Check operator has run setup-secrets.sh
echo "1. SST Secrets populated (run scripts/setup-secrets.sh):"
for SECRET in RazonSocial Nit Direccion RepLegal EmailPublico DpoEmail; do
  if sst secret list 2>/dev/null | grep -q "$SECRET"; then
    echo "   OK $SECRET"
  else
    echo "   MISSING $SECRET (run scripts/setup-secrets.sh first)"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# 2. Check DPO user exists in Cognito with dpo group
echo "2. DPO user in Cognito:"
DPO_USER=$(aws cognito-idp admin-get-user \
  --user-pool-id us-east-1_LItAcj2Aa \
  --username nicourrutia83@gmail.com 2>/dev/null \
  || echo "")
if [ -n "$DPO_USER" ]; then
  DPO_GROUPS=$(aws cognito-idp admin-list-groups-for-user \
    --user-pool-id us-east-1_LItAcj2Aa \
    --username nicourrutia83@gmail.com \
    --query 'Groups[?GroupName==`dpo`].GroupName' \
    --output text 2>/dev/null || echo "")
  if [ "$DPO_GROUPS" = "dpo" ]; then
    echo "   OK DPO user nicourrutia83@gmail.com is in 'dpo' group"
  else
    echo "   MISSING DPO user exists but NOT in 'dpo' group"
    echo "      Run: aws cognito-idp admin-add-user-to-group \\\\"
    echo "             --user-pool-id us-east-1_LItAcj2Aa \\\\"
    echo "             --username nicourrutia83@gmail.com \\\\"
    echo "             --group-name dpo"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "   MISSING DPO user nicourrutia83@gmail.com does NOT exist in Cognito"
  echo "      Run: aws cognito-idp admin-create-user \\\\"
  echo "             --user-pool-id us-east-1_LItAcj2Aa \\\\"
  echo "             --username nicourrutia83@gmail.com \\\\"
  echo "             --user-attributes Name=email,Value=nicourrutia83@gmail.com Name=email_verified,Value=true"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 3. Check SES is out of sandbox
echo "3. AWS SES production access:"
SES_STATUS=$(aws ses get-account-sending-enabled --region us-east-1 --output text 2>/dev/null || echo "")
if [ "$SES_STATUS" = "True" ]; then
  echo "   OK SES production access enabled"
else
  echo "   WARN SES still in sandbox — request production access before go-live"
  echo "      https://console.aws.amazon.com/ses/home#/account"
fi
echo ""

# 4. Check ComplianceAPI deployed
echo "4. ComplianceAPI Lambda deployed:"
API_STATUS=$(sst status 2>/dev/null | grep "ComplianceAPI" || echo "")
if [ -n "$API_STATUS" ]; then
  echo "   OK ComplianceAPI found in SST status"
else
  echo "   MISSING ComplianceAPI not deployed — run: npx sst deploy --stage prod"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Summary
if [ $ERRORS -eq 0 ]; then
  echo "ALL CHECKS PASS — ready to submit RNBD registration"
  echo ""
  echo "Next steps:"
  echo "  1. bash scripts/rnbd/generate-form-payload.sh"
  echo "  2. Open https://www.sic.gov.co/registro-nacional-de-bases-de-datos"
  echo "  3. Authenticate with operador's certificado digital"
  echo "  4. Paste values from rnbd-form-payload.json"
else
  echo "$ERRORS blocking issue(s) — fix before continuing"
  exit 1
fi