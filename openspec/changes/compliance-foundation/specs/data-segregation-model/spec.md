# data-segregation-model Specification

## Purpose

Colombia's Ley 1581/2012 distinguishes between public-commercial establishment data (permissive) and personal-representative data (consent-required). This spec mandates schema-level separation between the two domains so that no personal data leaks into public surfaces.

## Requirements

### Requirement: Two Schema Domains

The system MUST maintain two logically isolated schema domains:

- `datos_publicos_establecimiento`: `razon_social`, `nit`, `direccion_registrada`, `horarios_publicados`, `categoria`, `fotos`, `descripcion`
- `datos_personales_representante`: `email_rep`, `telefono_rep`, `firma_rep`, `nombre_rep`

#### Scenario: Logical isolation enforced

- GIVEN a developer queries the public API for a listing
- WHEN the response is constructed
- THEN no field from `datos_personales_representante` SHALL be included

### Requirement: Explicit Consent Token

The system SHALL NOT persist any field in `datos_personales_representante` without an explicit, timestamped consent token signed by the titular.

#### Scenario: Save without consent is rejected

- GIVEN a tenant admin attempts to save `email_rep = "rep@example.com"`
- WHEN no consent token exists for this representative
- THEN the save MUST be rejected with `CONSENT_REQUIRED` error

### Requirement: Representative Data Access Isolation

Fields in `datos_personales_representante` SHALL ONLY be readable by authenticated tenant admins with claim verification AND a valid consent token.

#### Scenario: Cross-tenant access blocked

- GIVEN tenant A's admin is authenticated
- WHEN they attempt to read tenant B's representative data
- THEN the request MUST be rejected with `FORBIDDEN_CROSS_TENANT`

### Requirement: Public Scraping Default

The ingestion pipeline MUST default to extracting only `datos_publicos_establecimiento`. Personal representative fields MUST be filtered out before storage.

#### Scenario: Personal email in scraped page is filtered

- GIVEN a scraper extracts a page containing "Contact: juan@example.com"
- WHEN the page is processed for storage
- THEN the email SHALL be dropped and only public fields persisted

### Requirement: Public Listing Display

The public listing page MUST display only `datos_publicos_establecimiento`. Representative contact fields SHALL NOT appear anywhere on public pages.

#### Scenario: Public page has no personal contact

- GIVEN a public listing page renders
- WHEN the DOM is scanned for `email_rep`, `telefono_rep`, `firma_rep`
- THEN none of these fields SHALL appear in the rendered HTML
