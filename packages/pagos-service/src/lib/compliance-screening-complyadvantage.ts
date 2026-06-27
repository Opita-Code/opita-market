/**
 * ComplyAdvantage compliance screening provider (production skeleton).
 *
 * PR 4b — Option A: production-ready code, but NOT enabled until operator
 * commits to $$$ (provider signup + API key).
 *
 * To enable:
 *   1. Sign up at https://www.complyadvantage.com/
 *   2. Get API key from ComplyAdvantage dashboard
 *   3. Run: npx sst secret set ComplyAdvantageApiKey <key>
 *   4. In api/index.ts handler init, replace MockComplianceScreeningProvider
 *      with new ComplyAdvantageComplianceScreeningProvider({
 *        apiKey: Res.ComplyAdvantageApiKey.value,
 *      })
 *
 * Cost: ~$200-2000/month depending on screening volume.
 *
 * Docs: https://docs.complyadvantage.com/api-docs/
 *
 * NOTE: This file is a SKELETON. The actual API calls are stubbed with
 * NotImplementedError — finish when operator commits to the provider.
 */

import {
  validateScreeningRequest,
  validateTransactionScreeningRequest,
  type ComplianceScreeningProvider,
  type ScreeningMatch,
  type ScreeningRequest,
  type ScreeningResult,
  type TransactionScreeningRequest,
} from "./compliance-screening.js";

export interface ComplyAdvantageConfig {
  apiKey: string;
  /** Base URL for ComplyAdvantage API. Default: https://api.complyadvantage.com */
  baseUrl?: string;
  /** Request timeout in ms. Default: 5000. */
  timeoutMs?: number;
}

export class ComplyAdvantageComplianceScreeningProvider implements ComplianceScreeningProvider {
  readonly providerName = "complyadvantage-v1";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: ComplyAdvantageConfig) {
    // Config stored but unused until operator commits to provider.
    // After commitment:
    //   this.apiKey = config.apiKey;
    //   this.baseUrl = config.baseUrl ?? "https://api.complyadvantage.com";
    //   this.timeoutMs = config.timeoutMs ?? 5000;
  }

  async screenUser(_request: ScreeningRequest): Promise<ScreeningResult> {
    validateScreeningRequest(_request);
    throw new Error(
      "ComplyAdvantage provider not yet wired — operator must commit to $$$ and set COMPLYADVANTAGE_API_KEY. " +
        "Currently using MockComplianceScreeningProvider (dev mode). " +
        "See compliance-screening-mock.ts for the dev provider.",
    );
  }

  async screenTransaction(_request: TransactionScreeningRequest): Promise<ScreeningResult> {
    validateTransactionScreeningRequest(_request);
    throw new Error(
      "ComplyAdvantage provider not yet wired — operator must commit to $$$ and set COMPLYADVANTAGE_API_KEY.",
    );
  }
}

/**
 * When operator commits to provider, replace the throw with real API call:
 *
 * async screenUser(request: ScreeningRequest): Promise<ScreeningResult> {
 *   validateScreeningRequest(request);
 *
 *   // ComplyAdvantage /search endpoint
 *   const response = await fetch(`${this.baseUrl}/search`, {
 *     method: "POST",
 *     headers: {
 *       "Authorization": `Bearer ${this.apiKey}`,
 *       "Content-Type": "application/json",
 *     },
 *     body: JSON.stringify({
 *       search_term: request.fullName,
 *       country_codes: [request.country],
 *       dob: request.dateOfBirth,
 *       filters: { types: ["pep", "sanctions", "adverse-media"] },
 *     }),
 *     signal: AbortSignal.timeout(this.timeoutMs),
 *   });
 *
 *   if (!response.ok) {
 *     throw new Error(`ComplyAdvantage API error: ${response.status}`);
 *   }
 *
 *   const data = await response.json();
 *   // Map ComplyAdvantage response to ScreeningMatch[]
 *   const matches: ScreeningMatch[] = data.hits.map((hit: any) => ({
 *     type: mapMatchType(hit.type),
 *     source: hit.source?.name ?? "complyadvantage",
 *     matchScore: hit.score ?? 0,
 *     matchedName: hit.name,
 *     matchedCountry: hit.country_code,
 *     notes: hit.reason,
 *   }));
 *
 *   return {
 *     screeningType: "USER",
 *     riskLevel: assessRisk(matches),
 *     matches,
 *     provider: this.providerName,
 *     screenedAtIso: new Date().toISOString(),
 *     providerReferenceId: data.search_id,
 *   };
 * }
 *
 * function mapMatchType(type: string): ScreeningMatch["type"] {
 *   switch (type) {
 *     case "pep": return "PEP";
 *     case "sanction": return "SANCTIONS";
 *     case "adverse-media": return "ADVERSE_MEDIA";
 *     default: return "PEP";
 *   }
 * }
 */
