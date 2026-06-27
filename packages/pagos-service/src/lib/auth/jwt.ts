/**
 * JWT verification using jose.
 *
 * - HS256 (shared secret with opita-account-ui)
 * - aud + iss + exp validated by jose
 * - Returns { sub, email, groups }
 */

import { jwtVerify, type JWTPayload } from "jose";
import {
  ExpiredTokenError,
  InvalidAudienceError,
  InvalidIssuerError,
  InvalidSignatureError,
  UnauthenticatedError,
} from "./errors.js";
import type { Role } from "./types.js";

const encoder = new TextEncoder();

export interface VerifiedJwt {
  sub: string;
  email: string;
  groups: Role[];
}

export async function verifyJwt(
  token: string,
  secret: string,
  expectedAud: string,
  expectedIss: string,
): Promise<VerifiedJwt> {
  if (!token || typeof token !== "string") {
    throw new UnauthenticatedError();
  }
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ["HS256"],
      audience: expectedAud,
      issuer: expectedIss,
    });
    payload = result.payload;
  } catch (err) {
    // jose v5 errors have a `code` property (e.g., "ERR_JWT_EXPIRED") and
    // JWTClaimValidationFailed also exposes a `claim` property identifying
    // the failing claim ('aud' | 'iss' | 'exp' | 'nbf' | etc.).
    const code = (err as { code?: string }).code;
    const claim = (err as { claim?: string }).claim;
    if (code === "ERR_JWT_EXPIRED") throw new ExpiredTokenError();
    if (claim === "aud") throw new InvalidAudienceError();
    if (claim === "iss") throw new InvalidIssuerError();
    if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") throw new InvalidSignatureError();
    throw new UnauthenticatedError();
  }

  if (!payload.sub || typeof payload.email !== "string") {
    throw new UnauthenticatedError();
  }

  // cognito:groups may be a string or string array; normalize to Role[]
  const rawGroups = payload["cognito:groups"];
  const groups: Role[] = Array.isArray(rawGroups)
    ? (rawGroups.filter((g) => typeof g === "string") as Role[])
    : typeof rawGroups === "string"
    ? ([rawGroups] as Role[])
    : [];

  return {
    sub: payload.sub,
    email: payload.email,
    groups,
  };
}
