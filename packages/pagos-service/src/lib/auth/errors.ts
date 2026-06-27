/**
 * Auth gateway errors.
 *
 * Every auth error MUST be a subclass of AuthError so the HTTP layer can
 * map error_code → HTTP status + body deterministically (R6: no info leak).
 *
 * NO error message may include JWT claims, role names, or internal structure.
 */

import { OpitaPagosError } from "../errors.js";

export abstract class AuthError extends OpitaPagosError {
  // Auth errors never expose internal info to the client (R6).
  readonly exposeMessage = false;
}

export class UnauthenticatedError extends AuthError {
  readonly code = "UNAUTHENTICATED";
  readonly httpStatus = 401;
  constructor() {
    super("Authentication required");
  }
}

export class InvalidAudienceError extends AuthError {
  readonly code = "INVALID_AUDIENCE";
  readonly httpStatus = 401;
  constructor() {
    super("Invalid token audience");
  }
}

export class InvalidIssuerError extends AuthError {
  readonly code = "INVALID_ISSUER";
  readonly httpStatus = 401;
  constructor() {
    super("Invalid token issuer");
  }
}

export class ExpiredTokenError extends AuthError {
  readonly code = "EXPIRED_TOKEN";
  readonly httpStatus = 401;
  constructor() {
    super("Token has expired");
  }
}

export class InvalidSignatureError extends AuthError {
  readonly code = "INVALID_SIGNATURE";
  readonly httpStatus = 401;
  constructor() {
    super("Invalid token signature");
  }
}

export class ForbiddenError extends AuthError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
  constructor() {
    super("Insufficient permissions");
  }
}

export class RateLimitError extends AuthError {
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly httpStatus = 429;
  constructor(
    message: string = "Rate limit exceeded",
    public readonly retryAfterSeconds: number = 60,
  ) {
    super(message);
  }
}
