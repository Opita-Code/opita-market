/**
 * Verifik API client — third-party wrapper for RUES + DIAN lookups in Colombia.
 *
 * Per design.md §"Decision: NIT+DV verification service", we use Verifik
 * (https://api.verifik.co/v2/co/consultar-nit/{nit}?dv={dv}) instead of
 * scraping RUES directly — Ley 1273/2009 makes unauthorized scraping illegal.
 *
 * The client is a thin wrapper over fetch. Caching is delegated to the
 * caller (nit-dv.ts handler) so we can swap caches (DynamoDB vs LocalStack
 * in tests) without touching this module.
 *
 * Errors are typed so the caller can distinguish transient (HTTP 5xx,
 * network timeout) from terminal (HTTP 404 — NIT not found) failures.
 */

export interface VerifikNitResponse {
  /** Verifik's stable request id. */
  id?: string;
  razonSocial: string;
  estado: string; // "ACTIVA" | "INACTIVA" | ...
  tipoDocumento: string;
  numeroDocumento: string;
  dv: string;
  ciudad?: string;
  departamento?: string;
  direccion?: string;
  fechaConstitucion?: string;
  /** Raw Verifik payload (kept for the audit log — never trust the
   *  normalized fields alone for legal evidence). */
  _raw: Record<string, unknown>;
}

export class VerifikError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "UPSTREAM" | "NETWORK" | "AUTH",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "VerifikError";
  }
}

export interface VerifikClientOptions {
  baseUrl?: string;
  apiKey: string;
  /** Abort signal forwarded to fetch (timeout per request). */
  signal?: AbortSignal;
}

export function createVerifikClient(opts: VerifikClientOptions) {
  const baseUrl = (opts.baseUrl ?? "https://api.verifik.co").replace(/\/+$/, "");
  const apiKey = opts.apiKey;

  if (!apiKey) {
    throw new VerifikError("VERIFIK_API_KEY is required", "AUTH");
  }

  /** Verifik returns the DTO under different keys depending on the plan.
   *  We normalize to a flat shape and keep the raw payload under _raw. */
  function normalize(raw: Record<string, unknown>): VerifikNitResponse {
    const data = (raw.data as Record<string, unknown> | undefined) ?? raw;
    const razonSocial =
      (data.razonSocial as string | undefined) ??
      (data.razon_social as string | undefined) ??
      (data.nombre as string | undefined) ??
      "";
    const estado =
      (data.estado as string | undefined) ??
      (data.status as string | undefined) ??
      "DESCONOCIDO";
    const tipoDocumento =
      (data.tipoDocumento as string | undefined) ?? (data.tipo_documento as string | undefined) ?? "NIT";
    const numeroDocumento =
      (data.numeroDocumento as string | undefined) ?? (data.numero_documento as string | undefined) ?? "";
    const dv = (data.dv as string | undefined) ?? (data.digitoVerificacion as string | undefined) ?? "";
    return {
      id: (raw.id as string | undefined) ?? (data.id as string | undefined),
      razonSocial,
      estado,
      tipoDocumento,
      numeroDocumento,
      dv,
      ciudad: (data.ciudad as string | undefined) ?? (data.city as string | undefined),
      departamento: (data.departamento as string | undefined) ?? (data.state as string | undefined),
      direccion: (data.direccion as string | undefined) ?? (data.address as string | undefined),
      fechaConstitucion:
        (data.fechaConstitucion as string | undefined) ??
        (data.fecha_constitucion as string | undefined),
      _raw: raw,
    };
  }

  async function lookupNit(nit: string, dv: string): Promise<VerifikNitResponse> {
    if (!/^[0-9]{6,15}$/.test(nit)) {
      throw new VerifikError(`Invalid NIT: ${nit}`, "AUTH");
    }
    if (!/^[0-9kK]$/.test(dv)) {
      throw new VerifikError(`Invalid DV: ${dv}`, "AUTH");
    }
    const url = `${baseUrl}/v2/co/consultar-nit/${encodeURIComponent(nit)}?dv=${encodeURIComponent(dv)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": "opita-market-compliance/0.1.0",
        },
        signal: opts.signal,
      });
    } catch (e) {
      throw new VerifikError(`Network error: ${(e as Error).message}`, "NETWORK");
    }

    if (res.status === 404) {
      throw new VerifikError(`NIT ${nit}-${dv} not found`, "NOT_FOUND", 404);
    }
    if (res.status === 401 || res.status === 403) {
      throw new VerifikError("Verifik auth failed — check VERIFIK_API_KEY", "AUTH", res.status);
    }
    if (res.status >= 500) {
      throw new VerifikError(`Verifik upstream ${res.status}`, "UPSTREAM", res.status);
    }
    if (!res.ok) {
      const body = await safeText(res);
      throw new VerifikError(`Verifik ${res.status}: ${body.slice(0, 200)}`, "UPSTREAM", res.status);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new VerifikError("Verifik returned non-JSON response", "UPSTREAM", res.status);
    }
    return normalize(payload);
  }

  return { lookupNit, baseUrl };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}