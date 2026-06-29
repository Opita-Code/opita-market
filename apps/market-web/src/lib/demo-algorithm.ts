/**
 * Opita Market — Investor Demo: Smart Algorithm Explainer
 *
 * NOT a real ML model. This is a transparent, trace-based scoring function
 * that demonstrates HOW we'll recommend products to each user. Each trace shows:
 *   1. User context (location, intent)
 *   2. Per-business scoring with explicit factors
 *   3. Final ranked list with badges
 *
 * Scoring factors (designed for Colombian marketplace reality):
 *   - Geo relevance (35%): nearest businesses first
 *   - Verificado (25%): RUES + NIT verified = trustworthy
 *   - Acepta Opita Saldo (15%): wallet-friendly
 *   - Recency (15%): price data updated recently = fresh
 *   - Reputation (10%): high rating + review count
 *
 * Together: 100% — every factor weighted by what we know about Huila SMBs.
 */

import { NEGOCIOS, type DemoNegocio } from "./demo-data";

export type Factor = "geo" | "verificado" | "acepta_saldo" | "recencia" | "reputacion";

export interface FactorScore {
  factor: Factor;
  peso_pct: number;
  score: number; // 0-100 for this factor
  contribucion: number; // peso * score / 100
  explicacion: string;
}

export interface AlgoTrace {
  id: string;
  titulo: string;
  contexto_usuario: {
    ubicacion: string;
    intencion: string;
    notas: string;
  };
  candidatos_evaluados: number;
  ranking: Array<{
    negocio: DemoNegocio;
    score_total: number;
    factores: FactorScore[];
    badges: string[];
    razon_recomendacion: string;
  }>;
}

/**
 * Parse "hace X horas/días" into a numeric recency score 0-100.
 */
function recenciaScore(texto: string): { score: number; explicacion: string } {
  const minutosMatch = texto.match(/(\d+)\s*minuto/);
  const horasMatch = texto.match(/(\d+)\s*hora/);
  const diasMatch = texto.match(/(\d+)\s*d[ií]a/);

  if (minutosMatch) {
    const min = parseInt(minutosMatch[1]!, 10);
    return {
      score: Math.max(70, 100 - min / 6),
      explicacion: `Precios actualizados hace ${min} minutos`,
    };
  }
  if (horasMatch) {
    const h = parseInt(horasMatch[1]!, 10);
    return {
      score: Math.max(50, 100 - h * 4),
      explicacion: `Precios actualizados hace ${h} horas`,
    };
  }
  if (diasMatch) {
    const d = parseInt(diasMatch[1]!, 10);
    return {
      score: Math.max(10, 70 - d * 12),
      explicacion: `Precios actualizados hace ${d} días`,
    };
  }
  return { score: 30, explicacion: "Fecha de actualización desconocida" };
}

function geoScore(negocioCiudad: string, userCiudad: string): { score: number; explicacion: string } {
  if (negocioCiudad === userCiudad) {
    return { score: 100, explicacion: `Misma ciudad (${userCiudad})` };
  }
  // Ciudades del Huila cercanas (heurística simple)
  const huilaNorte = ["Neiva", "Rivera", "Palestina", "Tello"];
  const huilaCentro = ["Garzón", "Agrado", "Pital", "Tarqui"];
  const huilaSur = ["Pitalito", "Acevedo", "San Agustín"];
  const huilaOccidente = ["La Plata", "Paicol", "Tesalia"];

  const allGroups = [huilaNorte, huilaCentro, huilaSur, huilaOccidente];
  for (const group of allGroups) {
    if (group.includes(negocioCiudad) && group.includes(userCiudad)) {
      return { score: 65, explicacion: `Misma subregión del Huila` };
    }
  }
  // Mismo departamento, otra subregión
  return { score: 40, explicacion: `Otro municipio del Huila` };
}

function reputacionScore(negocio: DemoNegocio): { score: number; explicacion: string } {
  // Combine rating (0-5 → 0-100) and review count (logarithmic damping).
  const ratingPart = (negocio.rating / 5) * 80; // up to 80 points
  const reviewPart = Math.min(20, Math.log10(negocio.reviews_count + 1) * 10); // up to 20 points
  const score = Math.round(ratingPart + reviewPart);
  return {
    score,
    explicacion: `${negocio.rating}/5 · ${negocio.reviews_count} reseñas`,
  };
}

function evaluate(
  negocio: DemoNegocio,
  userCiudad: string,
): { factores: FactorScore[]; score_total: number } {
  const geo = geoScore(negocio.ciudad, userCiudad);
  const recencia = recenciaScore(negocio.precio_actualizado);
  const reputacion = reputacionScore(negocio);

  const factores: FactorScore[] = [
    {
      factor: "geo",
      peso_pct: 35,
      score: geo.score,
      contribucion: Math.round((35 * geo.score) / 100),
      explicacion: geo.explicacion,
    },
    {
      factor: "verificado",
      peso_pct: 25,
      score: negocio.verificado ? 100 : 25,
      contribucion: Math.round((25 * (negocio.verificado ? 100 : 25)) / 100),
      explicacion: negocio.verificado ? "NIT verificado por RUES" : "Pendiente verificación NIT",
    },
    {
      factor: "acepta_saldo",
      peso_pct: 15,
      score: negocio.acepta_saldo ? 100 : 40,
      contribucion: Math.round((15 * (negocio.acepta_saldo ? 100 : 40)) / 100),
      explicacion: negocio.acepta_saldo
        ? "Acepta Opita Saldo (cerrado, sin tarjeta)"
        : "Solo métodos tradicionales",
    },
    {
      factor: "recencia",
      peso_pct: 15,
      score: recencia.score,
      contribucion: Math.round((15 * recencia.score) / 100),
      explicacion: recencia.explicacion,
    },
    {
      factor: "reputacion",
      peso_pct: 10,
      score: reputacion.score,
      contribucion: Math.round((10 * reputacion.score) / 100),
      explicacion: reputacion.explicacion,
    },
  ];

  const score_total = factores.reduce((sum, f) => sum + f.contribucion, 0);
  return { factores, score_total };
}

// ============================================================================
// 3 demo traces — what the investor sees when they ask "¿cómo funciona?"
// ============================================================================

function buildTrace(
  id: string,
  titulo: string,
  contexto_usuario: AlgoTrace["contexto_usuario"],
  filter: (n: DemoNegocio) => boolean,
  userCiudad: string,
  limit = 3,
): AlgoTrace {
  const candidatos = NEGOCIOS.filter(filter);
  const evaluados = candidatos
    .map((n) => {
      const { factores, score_total } = evaluate(n, userCiudad);
      const badges: string[] = [];
      if (n.verificado) badges.push("✓ Verificado");
      if (n.acepta_saldo) badges.push("💰 Acepta Saldo");
      if (factores.find((f) => f.factor === "recencia")!.score >= 80) badges.push("🆕 Fresco");
      if (n.tier === "premium") badges.push("⭐ Premium");
      const razon = `Score ${score_total}/100: geo (${factores[0]!.contribucion}/35) + verificado (${factores[1]!.contribucion}/25) + saldo (${factores[2]!.contribucion}/15) + recencia (${factores[3]!.contribucion}/15) + reputación (${factores[4]!.contribucion}/10).`;
      return { negocio: n, score_total, factores, badges, razon_recomendacion: razon };
    })
    .sort((a, b) => b.score_total - a.score_total)
    .slice(0, limit);

  return {
    id,
    titulo,
    contexto_usuario,
    candidatos_evaluados: candidatos.length,
    ranking: evaluados,
  };
}

export const TRACES: AlgoTrace[] = [
  buildTrace(
    "neiva-salon",
    "Usuaria en Neiva busca salón de belleza",
    {
      ubicacion: "Neiva, Huila",
      intencion: "Manicura + diseño para el sábado",
      notas: "Quiere pagar con Opita Saldo, prefiere lugares verificados",
    },
    (n) => n.vertical === "beauty",
    "Neiva",
    3,
  ),
  buildTrace(
    "medellin-barber",
    "Usuario en Medellín busca barbería (viaja al Huila)",
    {
      ubicacion: "Medellín, Antioquia",
      intencion: "Corte + barba antes de evento familiar en Neiva",
      notas: "No conoce el Huila — confía en el badge de verificado",
    },
    (n) => n.vertical === "barber",
    "Medellín",
    3,
  ),
  buildTrace(
    "bogota-restaurant",
    "Usuario en Bogotá busca restaurante Opita Foods",
    {
      ubicacion: "Bogotá, D.C.",
      intencion: "Almorzar comida huilense cerca de la oficina",
      notas: "Quiere ver menú + precios antes de ir, valora reseñas",
    },
    (n) => n.vertical === "foods",
    "Bogotá",
    3,
  ),
];

export const FACTOR_PESOS: Record<Factor, number> = {
  geo: 35,
  verificado: 25,
  acepta_saldo: 15,
  recencia: 15,
  reputacion: 10,
};

export const FACTOR_DESCRIPCIONES: Record<Factor, { nombre: string; detalle: string }> = {
  geo: {
    nombre: "Cercanía geográfica",
    detalle:
      "Misma ciudad = 100, misma subregión del Huila = 65, otro municipio del Huila = 40. Refleja que la gente prefiere comprar donde puede ir.",
  },
  verificado: {
    nombre: "Negocio verificado",
    detalle:
      "RUES + verificación de NIT + DV contra DIAN. 100 si verificado, 25 si pendiente. Reduce listings fraudulentos.",
  },
  acepta_saldo: {
    nombre: "Acepta Opita Saldo",
    detalle:
      "Wallet cerrada, sin tarjeta, sin datáfono. 100 si acepta, 40 si solo métodos tradicionales. Diferenciador clave.",
  },
  recencia: {
    nombre: "Precios actualizados",
    detalle:
      "Precios viejos = desconfianza. Score degrada con horas: 100 si <1h, 50 si 12h, 10 si >5 días.",
  },
  reputacion: {
    nombre: "Reseñas verificables",
    detalle:
      "Rating 0-5 (80% del peso) + log(reviews) (20%). Combina calidad percibida con confianza estadística.",
  },
};

/** Stubs for the dashboard — what the user WOULD see with their data. */
export interface SaldoStub {
  balance_cop: number;
  opicoins: number;
}

export const SALDO_STUB: SaldoStub = {
  balance_cop: 87300,
  opicoins: 350,
};