#!/usr/bin/env bash
# scripts/setup-secrets.sh
#
# Populate the 6 SST Secrets that drive PTD + Aviso de Privacidad
# render-time substitution (compliance-foundation PR 4.5).
#
# Run ONCE per stage (`dev`, `prod`). After this script finishes, the
# MarketWeb Astro component receives PTD_RAZON_SOCIAL / PTD_NIT / etc.
# as env vars at deploy time and substitutes the {{TOKEN}} markers
# in apps/market-web/src/content/legal/*.md at render time.
#
# Usage:
#   bash scripts/setup-secrets.sh          # defaults to stage 'dev'
#   bash scripts/setup-secrets.sh dev
#   bash scripts/setup-secrets.sh prod
#
# Verification:
#   sst secret list --stage <stage>
#
# IMPORTANT:
#   - This script writes operator-supplied personal data into AWS Secrets
#     Manager. NEVER paste the output of `sst secret list` (it does NOT
#     echo values) and NEVER commit the values to git.
#   - The DPO email (PTD_DPO_EMAIL) is stored encrypted and exposed only
#     to the Astro server-side runtime. It is NOT rendered on any public
#     PTD/Aviso page — the public channel is PTD_EMAIL_PUBLICO.
#   - When Opita Code is constituted as S.A.S. or the legal address
#     changes, re-run this script with updated values. No code changes
#     are required: the .md files contain {{TOKEN}} markers and the
#     remark plugin substitutes at render time.

set -euo pipefail

STAGE="${1:-dev}"

echo "================================================"
echo "Opita Market — PTD/Aviso Secrets Setup"
echo "================================================"
echo ""
echo "Stage: $STAGE"
echo ""

# Verify the SST CLI is installed.
if ! command -v sst >/dev/null 2>&1; then
  echo "ERROR: sst CLI not installed." >&2
  echo "Install with: npm install -g sst" >&2
  exit 1
fi

# Verify AWS credentials are configured (sst secret set uses them).
if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not installed." >&2
  exit 1
fi

# The 6 secrets that apps/market-web/src/lib/legal-secrets.ts reads via
# process.env at runtime. Operator-supplied values follow.
#
# SECURITY:
#   - Replace these literals with your own values before running this
#     script against a real environment.
#   - For the DPO email: this address receives confidential rights-of-
#     titular requests. Use a personal mailbox you control; do NOT use
#     a generic alias or one tied to a contractor's work account.
#   - For the public email: this address is published on PTD + Aviso.
#     Use an inbox that is monitored and that can respond in ≤ 15 días
#     hábiles.

sst secret set --stage "$STAGE" RazonSocial   "Opita Code"
sst secret set --stage "$STAGE" Nit           "1007465784"
sst secret set --stage "$STAGE" Direccion     "Neiva, Huila, Colombia"
sst secret set --stage "$STAGE" RepLegal      "Representante Legal de Opita Code"
sst secret set --stage "$STAGE" EmailPublico  "Owner@opitacode.com"
sst secret set --stage "$STAGE" DpoEmail      "nicourrutia83@gmail.com"

echo ""
echo "OK — 6 secrets registered for stage: $STAGE"
echo ""
echo "Verify (does NOT echo values):"
echo "  sst secret list --stage $STAGE"
echo ""
echo "Next: redeploy MarketWeb so the new secrets are picked up:"
echo "  sst deploy --stage $STAGE"
