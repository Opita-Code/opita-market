# data-protection-compliance Specification

## Purpose

Opita Market operates under Colombia's Ley 1581/2012 (Habeas Data) + Decreto 1377/2013 + SIC Circular Única. This spec defines the compliance controls that MUST exist before any personal data is collected.

## Requirements

### Requirement: DPO Contracted

The system SHALL NOT process personal data until a Data Protection Officer (DPO) is formally contracted and onboarded.

#### Scenario: DPO missing blocks data ingestion

- GIVEN no DPO contract is active
- WHEN any ingestion pipeline attempts to write personal data
- THEN the pipeline MUST fail with a "DPO_REQUIRED" error and emit an alert

### Requirement: PTD + Aviso de Privacidad Published

The platform MUST publish a Política de Tratamiento de Datos (PTD) and Aviso de Privacidad at `market.opitacode.com/legal/{ptd,aviso}` in Spanish before any production data collection begins.

#### Scenario: Legal pages reachable from every page

- GIVEN a user visits any page on `market.opitacode.com`
- WHEN the page renders
- THEN the footer MUST contain visible links to both PTD and Aviso de Privacidad

### Requirement: RNBD Registration

The Opita Market database MUST be registered with SIC's Registro Nacional de Bases de Datos (RNBD) prior to processing personal data.

#### Scenario: Registration acceptance received

- GIVEN the RNBD registration has been submitted
- WHEN SIC confirms acceptance
- THEN the registration receipt SHALL be stored as an immutable audit artifact with timestamp

### Requirement: Annual RNBD Update

The DPO MUST update the RNBD registration between 2 January and 31 March each year.

#### Scenario: Update window detected

- GIVEN today is within 2 January to 31 March
- WHEN the DPO logs into the compliance dashboard
- THEN the system SHALL display an "RNBD update due" alert

### Requirement: Semiannual Complaint Report

The DPO MUST submit a report of titular complaints to SIC by 25 August (H1) and 28 February (H2) each year.

#### Scenario: Complaint report auto-draft

- GIVEN complaints were collected during H1
- WHEN today is 24 August
- THEN the system MUST auto-draft the H1 report and notify the DPO for review

### Requirement: Audit Log Retention

The audit log of all data-processing actions MUST be retained for at least 5 years per SIC requirement.

#### Scenario: Retention enforcement

- GIVEN an audit log entry older than 5 years
- WHEN retention policy runs
- THEN the entry SHALL be archived to cold storage, not deleted
