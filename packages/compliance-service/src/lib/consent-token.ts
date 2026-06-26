/**
 * Consent tokens — Ley 1581/2012 Art. 9 requires explicit, timestamped consent
 * for every datos_personales_representante row. We encode each consent grant
 * as a signed JWT carrying { nit, dv, scopes, iat, exp, jti } so:
 *
 *   1. The token is portable (can be issued by one service and verified by another).
 *   2. The signature is non-repudiable (titular's browser signs via the
 *      account-ui flow; the JWT_SECRET never leaves our infrastructure).
 *   3. The `scopes` claim lets us encode granular grants (e.g. "marketing_email"
 *      vs "billing_contact") so future requirements like Art. 7 (sensitive
 *      data) can revoke without nuking the whole consent record.
 *
 * Verification is constant-time via jose.jwtVerify. Tokens older than 24h
 * (default `maxAgeSeconds`) are rejected even if the `exp` is further out —
 * this limits blast radius if a token leaks.
 */

import * as jose from "jose";

export interface ConsentTokenClaims {
  /** NIT del titular (6-15 digits, leading zeros preserved). */
  nit: string;
  /** Dígito de verificación (0-9 or K). */
  dv: string;
  /** Granted scopes. Reserved vocabulary:
   *  - "rep.contact_email"  — email_rep persistence + downstream use
   *  - "rep.contact_phone"  — telefono_rep persistence + downstream use
   *  - "rep.signature"      — firma_rep persistence
   *  - "rep.role"           — cargo_rep persistence
   *  - "marketing.email"    — outbound marketing mailings (separate consent)
   */
  scopes: ReadonlyArray<string>;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expires-at (unix seconds). Hard cap = 365d. */
  exp: number;
  /** Unique token id (jose-generated `jti`). */
  jti: string;
}

export interface ConsentTokenInput {
  nit: string;
  dv: string;
  scopes: ReadonlyArray<string>;
  /** Seconds until expiry from now. Default 30 days. Hard cap 365d. */
  ttlSeconds?: number;
  /** Optional explicit jti (tests). Default: random UUID. */
  jti?: string;
}

export class ConsentTokenError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ConsentTokenError";
  }
}

const NIT_RE = /^[0-9]{6,15}$/;
const DV_RE = /^[0-9kK]$/;
const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;

function assertNitDv(nit: string, dv: string): void {
  if (!NIT_RE.test(nit)) {
    throw new ConsentTokenError(`Invalid NIT format: ${nit}`, "INVALID_NIT");
  }
  if (!DV_RE.test(dv)) {
    throw new ConsentTokenError(`Invalid DV format: ${dv}`, "INVALID_DV");
  }
}

async function getSigningKey(secret: string): Promise<Uint8Array> {
  return new TextEncoder().encode(secret);
}

/** Sign a consent token. Returns a compact JWS string. */
export async function signConsentToken(input: ConsentTokenInput, secret: string): Promise<string> {
  if (!secret) throw new ConsentTokenError("JWT_SECRET is required", "MISSING_SECRET");
  assertNitDv(input.nit, input.dv);
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw new ConsentTokenError("At least one scope is required", "MISSING_SCOPES");
  }
  const ttl = Math.min(Math.max(input.ttlSeconds ?? 30 * 24 * 60 * 60, 1), MAX_TTL_SECONDS);
  const now = Math.floor(Date.now() / 1000);
  const claims: ConsentTokenClaims = {
    nit: input.nit,
    dv: input.dv,
    scopes: [...input.scopes],
    iat: now,
    exp: now + ttl,
    jti: input.jti ?? crypto.randomUUID(),
  };
  return new jose.SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .setJti(claims.jti)
    .setIssuer("opita-market-compliance")
    .setAudience("opita-market-compliance")
    .sign(await getSigningKey(secret));
}

export interface VerifyConsentTokenOptions {
  /** Maximum token age in seconds (default 24h). Tokens older than this are
   *  rejected even if their `exp` is in the future. */
  maxAgeSeconds?: number;
  /** Required scope — verify fails if the token does not carry this scope. */
  requiredScope?: string;
}

export async function verifyConsentToken(
  token: string,
  secret: string,
  opts: VerifyConsentTokenOptions = {},
): Promise<ConsentTokenClaims> {
  if (!secret) throw new ConsentTokenError("JWT_SECRET is required", "MISSING_SECRET");
  if (!token || typeof token !== "string") {
    throw new ConsentTokenError("Token is empty", "EMPTY_TOKEN");
  }
  const maxAge = opts.maxAgeSeconds ?? 24 * 60 * 60;
  try {
    const { payload } = await jose.jwtVerify(token, await getSigningKey(secret), {
      issuer: "opita-market-compliance",
      audience: "opita-market-compliance",
      maxTokenAge: maxAge,
    });
    const claims = payload as unknown as ConsentTokenClaims;
    if (!claims.nit || !claims.dv) {
      throw new ConsentTokenError("Token missing nit/dv", "MISSING_CLAIMS");
    }
    assertNitDv(claims.nit, claims.dv);
    if (opts.requiredScope && !claims.scopes?.includes(opts.requiredScope)) {
      throw new ConsentTokenError(`Missing required scope: ${opts.requiredScope}`, "MISSING_SCOPE");
    }
    return claims;
  } catch (e) {
    if (e instanceof ConsentTokenError) throw e;
    throw new ConsentTokenError(`Invalid token: ${(e as Error).message}`, "INVALID_TOKEN");
  }
}