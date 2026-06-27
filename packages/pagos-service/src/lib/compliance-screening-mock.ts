/**
 * Mock compliance screening provider (dev + test).
 *
 * Returns deterministic results based on a built-in watchlist of test names.
 * No external API calls. Safe for dev, tests, and offline environments.
 *
 * To swap in a real provider (ComplyAdvantage / Refinitiv / etc.):
 *   1. Implement `ComplianceScreeningProvider` (see compliance-screening.ts)
 *   2. In api/index.ts handler init, replace `new MockComplianceScreeningProvider()`
 *      with `new ComplyAdvantageComplianceScreeningProvider({ apiKey: ... })`
 *   3. Set COMPLYADVANTAGE_API_KEY in SST Secrets (sst secret set)
 */

import {
  assessRisk,
  validateScreeningRequest,
  validateTransactionScreeningRequest,
  type ComplianceScreeningProvider,
  type ScreeningMatch,
  type ScreeningRequest,
  type ScreeningResult,
  type TransactionScreeningRequest,
} from "./compliance-screening.js";

/**
 * Test PEP watchlist — names matching these are flagged as HIGH risk PEP.
 * In production, this list is replaced by ComplyAdvantage / OFAC / UN APIs.
 */
const PEP_WATCHLIST: Array<{ name: string; country: string; notes?: string }> = [
  { name: "Juan PEP Test", country: "CO", notes: "Test fixture — fake PEP for unit tests" },
  { name: "Maria PEP Example", country: "MX" },
];

/**
 * Test sanctions watchlist — names matching these are flagged as HIGH risk.
 * In production, replaced by OFAC SDN + UN Security Council + EU Consolidated.
 */
const SANCTIONS_WATCHLIST: Array<{ name: string; country: string; notes?: string }> = [
  { name: "Evil Sanctioned Person", country: "XX", notes: "Test fixture — fake sanctions" },
];

/**
 * Adverse media watchlist — names matching these are flagged as MEDIUM risk.
 * In production, replaced by news/media screening APIs.
 */
const ADVERSE_MEDIA_WATCHLIST: Array<{ name: string; country: string }> = [
  { name: "Questionable Business Person", country: "BR" },
];

function matchesWatchlist(
  fullName: string,
  country: string,
  watchlist: Array<{ name: string; country: string }>,
): boolean {
  const name = fullName.toLowerCase().trim();
  return watchlist.some(
    (entry) => name.includes(entry.name.toLowerCase()) && (entry.country === "*" || entry.country === country),
  );
}

function findMatch(
  fullName: string,
  country: string,
  watchlist: Array<{ name: string; country: string; notes?: string }>,
  type: ScreeningMatch["type"],
  source: string,
): ScreeningMatch | null {
  const name = fullName.toLowerCase().trim();
  for (const entry of watchlist) {
    if (name.includes(entry.name.toLowerCase()) && (entry.country === "*" || entry.country === country)) {
      return {
        type,
        source,
        matchScore: type === "SANCTIONS" ? 0.95 : 0.9, // High-confidence matches for test fixtures
        matchedName: entry.name,
        matchedCountry: entry.country,
        notes: entry.notes,
      };
    }
  }
  return null;
}

export class MockComplianceScreeningProvider implements ComplianceScreeningProvider {
  readonly providerName = "mock-compliance-screening-v1";

  async screenUser(request: ScreeningRequest): Promise<ScreeningResult> {
    validateScreeningRequest(request);

    const matches: ScreeningMatch[] = [];

    const pep = findMatch(request.fullName, request.country, PEP_WATCHLIST, "PEP", "mock-pep-watchlist");
    if (pep) matches.push(pep);

    const sanctions = findMatch(
      request.fullName,
      request.country,
      SANCTIONS_WATCHLIST,
      "SANCTIONS",
      "mock-ofac-sdn",
    );
    if (sanctions) matches.push(sanctions);

    const media = findMatch(
      request.fullName,
      request.country,
      ADVERSE_MEDIA_WATCHLIST,
      "ADVERSE_MEDIA",
      "mock-news-watchlist",
    );
    if (media) matches.push(media);

    return {
      screeningType: "USER",
      riskLevel: assessRisk(matches),
      matches,
      provider: this.providerName,
      screenedAtIso: new Date().toISOString(),
      providerReferenceId: `mock-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  async screenTransaction(request: TransactionScreeningRequest): Promise<ScreeningResult> {
    validateTransactionScreeningRequest(request);

    const matches: ScreeningMatch[] = [];

    // If counterparty name is provided, screen against watchlists
    if (request.counterpartyName && request.counterpartyCountry) {
      const pep = findMatch(
        request.counterpartyName,
        request.counterpartyCountry,
        PEP_WATCHLIST,
        "PEP",
        "mock-pep-watchlist",
      );
      if (pep) matches.push(pep);

      const sanctions = findMatch(
        request.counterpartyName,
        request.counterpartyCountry,
        SANCTIONS_WATCHLIST,
        "SANCTIONS",
        "mock-ofac-sdn",
      );
      if (sanctions) matches.push(sanctions);
    }

    return {
      screeningType: "TRANSACTION",
      riskLevel: assessRisk(matches),
      matches,
      provider: this.providerName,
      screenedAtIso: new Date().toISOString(),
      providerReferenceId: `mock-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}
