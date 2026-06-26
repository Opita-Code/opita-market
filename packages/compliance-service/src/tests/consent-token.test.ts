import { describe, expect, it } from "vitest";
import {
  signConsentToken,
  verifyConsentToken,
  ConsentTokenError,
} from "../lib/consent-token.js";

const SECRET = "test-secret-do-not-use-in-prod-32chars-min";

describe("consent-token (Ley 1581/2012 Art. 9)", () => {
  it("signs and verifies a happy-path token", async () => {
    const token = await signConsentToken(
      { nit: "900123456", dv: "7", scopes: ["rep.contact_email"] },
      SECRET,
    );
    const claims = await verifyConsentToken(token, SECRET);
    expect(claims.nit).toBe("900123456");
    expect(claims.dv).toBe("7");
    expect(claims.scopes).toContain("rep.contact_email");
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await signConsentToken(
      { nit: "900123456", dv: "7", scopes: ["rep.contact_email"] },
      SECRET,
    );
    await expect(verifyConsentToken(token, "different-secret")).rejects.toBeInstanceOf(ConsentTokenError);
  });

  it("rejects tokens with invalid NIT", async () => {
    await expect(
      signConsentToken({ nit: "abc", dv: "7", scopes: ["rep.contact_email"] }, SECRET),
    ).rejects.toThrow(/Invalid NIT/);
  });

  it("rejects tokens with invalid DV", async () => {
    await expect(
      signConsentToken({ nit: "900123456", dv: "X", scopes: ["rep.contact_email"] }, SECRET),
    ).rejects.toThrow(/Invalid DV/);
  });

  it("rejects tokens without scopes", async () => {
    await expect(
      signConsentToken({ nit: "900123456", dv: "7", scopes: [] }, SECRET),
    ).rejects.toThrow(/at least one scope/i);
  });

  it("enforces requiredScope on verify", async () => {
    const token = await signConsentToken(
      { nit: "900123456", dv: "7", scopes: ["marketing.email"] },
      SECRET,
    );
    await expect(
      verifyConsentToken(token, SECRET, { requiredScope: "rep.contact_email" }),
    ).rejects.toThrow(/Missing required scope/);
  });

  it("rejects expired tokens", async () => {
    const token = await signConsentToken(
      { nit: "900123456", dv: "7", scopes: ["rep.contact_email"], ttlSeconds: 1 },
      SECRET,
    );
    await new Promise((r) => setTimeout(r, 1500));
    await expect(verifyConsentToken(token, SECRET)).rejects.toBeInstanceOf(ConsentTokenError);
  });

  it("rejects tokens older than maxAgeSeconds even if exp is far in the future", async () => {
    // Sign a token with ttl=1h, then verify with maxAgeSeconds=10s — must fail.
    const token = await signConsentToken(
      { nit: "900123456", dv: "7", scopes: ["rep.contact_email"], ttlSeconds: 3600 },
      SECRET,
    );
    // Backdate by manipulating time: re-sign with explicit iat far in the past
    // is not directly supported, so we instead use jose's clockTolerance path.
    // We approximate by asserting the default 24h maxAge with a token signed
    // 25h ago via a custom issuer — easier path: forge a token with iat=0 via
    // a small helper.
    const jose = await import("jose");
    const key = new TextEncoder().encode(SECRET);
    const forged = await new jose.SignJWT({
      nit: "900123456",
      dv: "7",
      scopes: ["rep.contact_email"],
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(0)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 7200)
      .setJti("forged-test")
      .setIssuer("opita-market-compliance")
      .setAudience("opita-market-compliance")
      .sign(key);
    await expect(verifyConsentToken(forged, SECRET)).rejects.toBeInstanceOf(ConsentTokenError);
    void token;
  });
});