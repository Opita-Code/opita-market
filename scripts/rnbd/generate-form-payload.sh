#!/usr/bin/env bash
# scripts/rnbd/generate-form-payload.sh
#
# Generates the RNBD registration form payload as JSON.
# Operator manually pastes these values into the SIC portal at:
#   https://www.sic.gov.co/registro-nacional-de-bases-de-datos
#
# The SIC portal requires an operator's certificado digital + manual
# submission. This script does NOT auto-submit (legal act under
# Ley 1581/2012 + Decreto 1377/2013). It ONLY pulls the SST Secrets that
# were populated by scripts/setup-secrets.sh and assembles the JSON the
# operator will paste into the portal.
#
# Usage:
#   bash scripts/rnbd/generate-form-payload.sh
#
# Output:
#   rnbd-form-payload.json (in cwd)
#
# After generating the payload:
#   1. Open https://www.sic.gov.co/registro-nacional-de-bases-de-datos
#   2. Authenticate with operator's certificado digital
#   3. Copy/paste values from rnbd-form-payload.json
#   4. Submit registration
#   5. Save the SIC receipt (PDF) to scripts/rnbd/receipts/<date>-rnbd-receipt.pdf
#   6. Run: bash scripts/rnbd/upload-receipt.sh scripts/rnbd/receipts/<date>-rnbd-receipt.pdf
#
# Compliance-foundation PR 5 — task 5.2.

set -euo pipefail

# Pull values from SST secrets (already populated by scripts/setup-secrets.sh)
RAZON_SOCIAL=$(sst secret get RazonSocial)
NIT=$(sst secret get Nit)
DIRECCION=$(sst secret get Direccion)
REP_LEGAL=$(sst secret get RepLegal)
EMAIL_PUBLICO=$(sst secret get EmailPublico)
DPO_EMAIL=$(sst secret get DpoEmail)

OUT_FILE="${OUT_FILE:-rnbd-form-payload.json}"

cat <<EOF > "${OUT_FILE}"
{
  "database_name": "OpitaMarket.PublicListings",
  "database_description": "Directorio publico de establecimientos comerciales de Opita Market (market.opitacode.com). Datos comerciales publicos: nombre del establecimiento, NIT, direccion registrada, horarios de atencion, coordenadas geograficas, categoria del negocio, fotos del local. NO incluye datos personales de representantes sin consentimiento explicito.",
  "controller": {
    "razon_social": "${RAZON_SOCIAL}",
    "nit": "${NIT}",
    "direccion": "${DIRECCION}",
    "representante_legal": "${REP_LEGAL}",
    "email_publico": "${EMAIL_PUBLICO}",
    "email_dpo_privado": "${DPO_EMAIL}"
  },
  "processor": null,
  "channel_for_rights": "${EMAIL_PUBLICO}",
  "treatment_purpose": "1. Publicar directorio de establecimientos comerciales para consulta publica. 2. Facilitar contacto entre usuarios y negocios. 3. Cumplir obligaciones legales y regulatorias. 4. Analisis agregados y anonimos para mejora del servicio.",
  "legal_basis": "Ley 1581 de 2012 (Habeas Data), Decreto 1377 de 2013, Circular Unica SIC",
  "data_categories": "Publicos: nombre comercial, NIT, direccion fisica, horarios, coordenadas, categoria, fotos. NO se recolectan datos sensibles.",
  "data_subject_categories": "Personas naturales propietarias o representantes de establecimientos comerciales (solo con consentimiento explicito)",
  "security_measures": "Medidas tecnicas: cifrado en transito (HTTPS/TLS), cifrado en reposo (Aurora Postgres + S3 KMS), segregacion de esquemas (public_commercial + representative_consented), JWT firmado para consentimiento, access logs con retencion 5 anos. Medidas administrativas: DPO designado, politica de tratamiento publicada, audit log de derechos del titular.",
  "international_transfers": null,
  "retention_period": "5 anos (minimo legal Ley 1581). Datos publicos del establecimiento: persistentes mientras el negocio exista. Datos personales del representante: hasta supresion solicitada o 5 anos, lo que ocurra primero.",
  "disposal_procedure": "Supresion automatica al recibir solicitud de titular (verificable via flujo 'derecho al olvido'). Anonimizacion para analisis agregados."
}
EOF

echo "OK ${OUT_FILE} generated"
echo ""
echo "NEXT STEPS:"
echo "1. Open https://www.sic.gov.co/registro-nacional-de-bases-de-datos"
echo "2. Log in with operator's certificado digital"
echo "3. Copy/paste values from ${OUT_FILE}"
echo "4. Submit registration"
echo "5. Save the SIC receipt (PDF) to scripts/rnbd/receipts/<date>-rnbd-receipt.pdf"
echo "6. Run: bash scripts/rnbd/upload-receipt.sh scripts/rnbd/receipts/<date>-rnbd-receipt.pdf"