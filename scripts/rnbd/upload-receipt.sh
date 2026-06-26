#!/usr/bin/env bash
# scripts/rnbd/upload-receipt.sh
#
# Upload RNBD registration receipt (PDF) to the immutable RnbdReceipts
# bucket. The bucket has Object Lock COMPLIANCE mode enabled (see
# sst.config.ts) — once uploaded, the file CANNOT be deleted or
# modified for the retention period (7 years), even by the AWS root.
#
# Usage:
#   bash scripts/rnbd/upload-receipt.sh <path-to-pdf>
#
# Example:
#   bash scripts/rnbd/upload-receipt.sh scripts/rnbd/receipts/2026-06-26-rnbd-receipt.pdf
#
# What this script does:
#   1. Resolves the bucket name (from `sst status` or CloudFormation).
#   2. Uploads the PDF with an Object Lock retain-until-date of +7 years.
#   3. Prints the S3 URI + the immutable lock expiry date.
#
# Compliance-foundation PR 5 — task 5.3.

set -euo pipefail

RECEIPT_PATH="${1:?Usage: $0 <path-to-receipt.pdf>}"

if [ ! -f "$RECEIPT_PATH" ]; then
  echo "ERROR: $RECEIPT_PATH does not exist"
  exit 1
fi

# Resolve bucket name. Prefer `sst status` (current stage); fall back
# to CloudFormation for prod where sst status may be slow.
BUCKET=""
if command -v sst >/dev/null 2>&1; then
  BUCKET=$(sst status 2>/dev/null | grep -oP 'RnbdReceipts\K\S+' | head -1 || echo "")
fi

if [ -z "$BUCKET" ] && command -v aws >/dev/null 2>&1; then
  BUCKET=$(aws cloudformation describe-stack-resources \
    --stack-name opita-market-prod \
    --query 'StackResources[?LogicalResourceId==`RnbdReceiptsBucket`].PhysicalResourceId' \
    --output text 2>/dev/null || echo "")
fi

if [ -z "$BUCKET" ]; then
  echo "ERROR: Could not find RnbdReceipts bucket name. Try: sst status --stage prod"
  exit 1
fi

# ISO 8601 UTC timestamp + +7y retain-until-date.
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
RETAIN_UNTIL=$(date -u -d '+7 years' +"%Y-%m-%dT%H:%M:%SZ")
RETAIN_UNTIL_HUMAN=$(date -u -d '+7 years' +"%Y-%m-%d")

KEY="receipts/${TIMESTAMP}-rnbd-receipt.pdf"

aws s3 cp "$RECEIPT_PATH" "s3://${BUCKET}/${KEY}" \
  --object-lock-mode COMPLIANCE \
  --object-lock-retain-until-date "$RETAIN_UNTIL"

echo ""
echo "OK Receipt uploaded to s3://${BUCKET}/${KEY}"
echo "   Object Lock: COMPLIANCE mode, 7-year retention"
echo "   Immutable until: ${RETAIN_UNTIL_HUMAN}"
echo "   Note: even the AWS root account CANNOT delete this object before that date."