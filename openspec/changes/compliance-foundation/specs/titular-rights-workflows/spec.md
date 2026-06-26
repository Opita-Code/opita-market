# titular-rights-workflows Specification

## Purpose

Ley 1581/2012 grants titulares four rights over their personal data: conocer (know), actualizar (update), rectificar (rectify), suprimir (suppress — "derecho al olvido"). This spec defines end-to-end workflows for each, all gated by NIT+DV identity verification.

## Requirements

### Requirement: Right to Know (Conocer)

Any titular MAY request a complete export of personal data the platform stores about them. The system MUST verify the requester's identity via NIT+DV before disclosure.

#### Scenario: Verified know request returns full data

- GIVEN a titular submits their NIT+DV via the rights-request endpoint
- WHEN the NIT+DV verifier confirms the identity
- THEN the system MUST return all personal data fields stored for that NIT within 15 business days

### Requirement: Right to Update (Actualizar)

A verified titular MAY submit corrections to their stored personal data.

#### Scenario: Phone number correction

- GIVEN a titular's verified identity
- WHEN they submit `{field: "telefono_rep", new_value: "+57 300 1234567"}`
- THEN the system MUST apply the update, write an audit log entry, and return confirmation

### Requirement: Right to Rectify (Rectificar)

A verified titular MAY dispute and request rectification of factual claims stored about them.

#### Scenario: Factual dispute resolved

- GIVEN a titular disputes their stored role description
- WHEN verified and review completed by DPO
- THEN the corrected role description is stored AND the audit log captures both old and new values

### Requirement: Right to Suppress (Suprimir)

A verified titular MAY request full suppression of all `datos_personales_representante` associated with their NIT+DV. Public listing MAY persist IF razón_social is verifiable from public sources (RUES, DIAN).

#### Scenario: Personal fields deleted, public listing may persist

- GIVEN a verified titular requests suppression
- WHEN the request is processed
- THEN all `datos_personales_representante` SHALL be deleted AND `datos_publicos_establecimiento` MAY remain IF razón_social is still verifiable from RUES/DIAN

### Requirement: Audit Trail for All Rights Requests

Every rights request MUST be logged with: timestamp, NIT+DV verifier response, action taken, DPO sign-off (for suppress/rectify).

#### Scenario: Audit row completeness

- GIVEN any rights request processed
- WHEN the audit row is written
- THEN it MUST contain all four required fields. Missing fields SHALL reject the row write with `AUDIT_INCOMPLETE`

### Requirement: 15-Business-Day SLA

The system MUST respond to any rights request within 15 business days of verified submission.

#### Scenario: SLA breach detected

- GIVEN a verified rights request is 16 business days old
- WHEN the SLA monitor runs
- THEN a breach alert MUST be raised to the DPO
