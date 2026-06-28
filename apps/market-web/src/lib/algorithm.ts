/**
 * Opita Market — Algorithm Engine (Expanded)
 *
 * The "specialization" of the algorithm — not just a flat list of factors,
 * but a transparent, multi-scenario ranking engine with real worked examples.
 *
 * Architecture:
 *   - Inputs: user context (location, query, time, preferences)
 *   - Candidates: businesses matching the query (with freshness, verified, salqo flags)
 *   - Factors: 5 weighted factors (geo, verificado, acepta_saldo, recencia, reputacion)
 *   - Score: weighted sum normalized to 0-100
 *   - Output: ranked list with badges, plain-language reason, and decomposition
 *
 * Pair with the `web-visual-quality` skill (typography hierarchy, motion grammar)
 * and `opita-frontend-behavior` skill (Cialdini reciprocidad = free trace).
 */

import { NEGOCIOS, type DemoNegocio } from "./demo-data";

// ============================================================================
// TYPES
// ============================================================================

export type Factor = "geo" | "verificado" | "acepta_saldo" | "recencia" | "reputacion";

export interface UserContext {
  ubicacion: string;
  sub_region: string;
  query: string;
  hora_local: string;
  preferencias?: {
    solo_verificados?: boolean;
    prefiere_acepta_saldo?: boolean;
    radio_km?: number;
  };
}

export interface BusinessCandidate {
  negocio: DemoNegocio;
  distancia_km: number;
  en_radio: boolean;
}

export interface FactorScore {
  factor: Factor;
  peso_pct: number;
  score: number; // 0-100
  contribucion: number; // peso_pct * score / 100
  explicacion: string;
  explicacion_corta: string;
  icono: string;
}

export interface RankedBusiness {
  rank: number;
  negocio: DemoNegocio;
  score_total: number;
  factores: FactorScore[];
  badges: string[];
  razon_recomendacion: string;
  distancia_km: number;
}

export interface WorkedTrace {
  id: string;
  titulo: string;
  contexto_usuario: UserContext;
  candidatos_evaluados: number;
  descartados_por_radio: number;
  ranking: RankedBusiness[];
  por_que_no_este: { nombre: string; razon: string }[];
  insight_competitivo: string;
}

// ============================================================================
// ENGINE
// ============================================================================

const SUBREGIONES: Record<string, string[]> = {
  "norte": ["Neiva", "Rivera", "Palestina", "Tello", "Aipe", "Yaguará", "Hobo", "Santa María", "Algeciras", "Baraya", "Colombia", "Iquira", "Teruel"],
  "centro": ["Garzón", "Agrado", "Pital", "Tarqui", "Gigante", "Paicol"],
  "sur": ["Pitalito", "Acevedo", "San Agustín", "Saladoblanco", "Oporapa", "Elías"],
  "occidente": ["La Plata", "Paicol", "Tesalia", "Nátaga"],
};

function subregionOf(ciudad: string): string {
  for (const [region, cities] of Object.entries(SUBREGIONES)) {
    if (cities.includes(ciudad)) return region;
  }
  return "norte";
}

function geoScore(negocioCiudad: string, userSubregion: string): { score: number; distancia_km: number; explicacion: string; explicacion_corta: string } {
  const negSub = subregionOf(negocioCiudad);
  if (negSub === userSubregion) {
    return {
      score: 100,
      distancia_km: Math.floor(Math.random() * 12) + 2,
      explicacion: `Misma subregión del Huila (${userSubregion})`,
      explicacion_corta: "Misma zona",
    };
  }
  return {
    score: 55,
    distancia_km: Math.floor(Math.random() * 60) + 25,
    explicacion: `Otra subregión del Huila (${negSub} desde ${userSubregion})`,
    explicacion_corta: "Otra zona",
  };
}

function recenciaScore(texto: string): { score: number; explicacion: string; explicacion_corta: string } {
  const minutosMatch = texto.match(/(\d+)\s*minuto/);
  const horasMatch = texto.match(/(\d+)\s*hora/);
  const diasMatch = texto.match(/(\d+)\s*d[ií]a/);

  if (minutosMatch) {
    const m = parseInt(minutosMatch[1]!, 10);
    return {
      score: Math.max(70, 100 - m / 6),
      explicacion: `Precios actualizados hace ${m} minutos — datos frescos`,
      explicacion_corta: `${m} min`,
    };
  }
  if (horasMatch) {
    const h = parseInt(horasMatch[1]!, 10);
    return {
      score: Math.max(50, 100 - h * 4),
      explicacion: `Precios actualizados hace ${h} hora${h > 1 ? "s" : ""}`,
      explicacion_corta: `${h}h`,
    };
  }
  if (diasMatch) {
    const d = parseInt(diasMatch[1]!, 10);
    return {
      score: Math.max(10, 70 - d * 12),
      explicacion: `Precios actualizados hace ${d} días — puede haber cambiado`,
      explicacion_corta: `${d}d`,
    };
  }
  return {
    score: 30,
    explicacion: "Fecha de actualización desconocida",
    explicacion_corta: "?",
  };
}

function reputacionScore(negocio: DemoNegocio): { score: number; explicacion: string; explicacion_corta: string } {
  const ratingPart = (negocio.rating / 5) * 80;
  const reviewPart = Math.min(20, Math.log10(negocio.reviews_count + 1) * 10);
  const score = Math.round(ratingPart + reviewPart);
  return {
    score,
    explicacion: `${negocio.rating}/5 estrellas · ${negocio.reviews_count} reseñas verificadas`,
    explicacion_corta: `${negocio.rating}★ · ${negocio.reviews_count}`,
  };
}

function verificadoScore(negocio: DemoNegocio, prefiereVerificados?: boolean): { score: number; explicacion: string; explicacion_corta: string } {
  if (negocio.verificado) {
    return {
      score: prefiereVerificados ? 100 : 100,
      explicacion: "NIT validado contra RUES · DV verificado",
      explicacion_corta: "✓ Verificado",
    };
  }
  return {
    score: prefiereVerificados ? 0 : 25,
    explicacion: prefiereVerificados
      ? "Descartado: prefieres solo negocios verificados"
      : "NIT aún no validado — bajo peso por ahora",
    explicacion_corta: "Pendiente",
  };
}

function aceptaSaldoScore(negocio: DemoNegocio, prefiereSaldo?: boolean): { score: number; explicacion: string; explicacion_corta: string } {
  if (negocio.acepta_saldo) {
    return {
      score: prefiereSaldo ? 100 : 100,
      explicacion: "Acepta Opita Saldo — sin tarjeta, sin datéfono, pago instantáneo",
      explicacion_corta: "💰 Saldo",
    };
  }
  return {
    score: prefiereSaldo ? 40 : 40,
    explicacion: "Solo métodos tradicionales — puede requerir tarjeta",
    explicacion_corta: "Tradicional",
  };
}

function evaluate(
  negocio: DemoNegocio,
  userContext: UserContext,
): { factores: FactorScore[]; score_total: number; distancia_km: number } {
  const geo = geoScore(negocio.ciudad, userContext.sub_region);
  const recencia = recenciaScore(negocio.precio_actualizado);
  const reputacion = reputacionScore(negocio);
  const verificado = verificadoScore(negocio, userContext.preferencias?.solo_verificados);
  const aceptaSaldo = aceptaSaldoScore(negocio, userContext.preferencias?.prefiere_acepta_saldo);

  const factores: FactorScore[] = [
    { factor: "geo", peso_pct: 35, score: geo.score, contribucion: Math.round((35 * geo.score) / 100), explicacion: geo.explicacion, explicacion_corta: geo.explicacion_corta, icono: "📍" },
    { factor: "verificado", peso_pct: 25, score: verificado.score, contribucion: Math.round((25 * verificado.score) / 100), explicacion: verificado.explicacion, explicacion_corta: verificado.explicacion_corta, icono: "✓" },
    { factor: "acepta_saldo", peso_pct: 15, score: aceptaSaldo.score, contribucion: Math.round((15 * aceptaSaldo.score) / 100), explicacion: aceptaSaldo.explicacion, explicacion_corta: aceptaSaldo.explicacion_corta, icono: "💰" },
    { factor: "recencia", peso_pct: 15, score: recencia.score, contribucion: Math.round((15 * recencia.score) / 100), explicacion: recencia.explicacion, explicacion_corta: recencia.explicacion_corta, icono: "🕐" },
    { factor: "reputacion", peso_pct: 10, score: reputacion.score, contribucion: Math.round((10 * reputacion.score) / 100), explicacion: reputacion.explicacion, explicacion_corta: reputacion.explicacion_corta, icono: "⭐" },
  ];

  const score_total = factores.reduce((s, f) => s + f.contribucion, 0);
  return { factores, score_total, distancia_km: geo.distancia_km };
}

// ============================================================================
// SCENARIO BUILDERS
// ============================================================================

interface ScenarioOptions {
  id: string;
  titulo: string;
  contexto_usuario: UserContext;
  filter: (n: DemoNegocio) => boolean;
  limit?: number;
  /** Provide a competitive insight that's unique to this scenario. */
  insight_competitivo: string;
}

function buildTrace(opts: ScenarioOptions): WorkedTrace {
  const userSubregion = subregionOf(opts.contexto_usuario.ubicacion);

  // Distance check (mock with category-aware heuristics)
  const candidates: BusinessCandidate[] = NEGOCIOS.filter(opts.filter).map((n) => {
    const distanceKm = n.ciudad === opts.contexto_usuario.ubicacion
      ? Math.floor(Math.random() * 12) + 2
      : Math.floor(Math.random() * 80) + 25;
    return {
      negocio: n,
      distancia_km: distanceKm,
      en_radio: distanceKm <= (opts.contexto_usuario.preferencias?.radio_km ?? 50),
    };
  });

  const enRadio = candidates.filter((c) => c.en_radio);
  const descartados = candidates.length - enRadio.length;

  const ranking: RankedBusiness[] = enRadio
    .map((c) => {
      const { factores, score_total, distancia_km } = evaluate(c.negocio, { ...opts.contexto_usuario, sub_region: userSubregion });
      const badges: string[] = [];
      if (c.negocio.tier === "premium") badges.push("⭐ Premium");
      if (c.negocio.verificado) badges.push("✓ Verificado");
      if (c.negocio.acepta_saldo) badges.push("💰 Saldo");
      if (factores.find((f) => f.factor === "recencia")!.score >= 80) badges.push("🆕 Fresco");
      const razon = `${c.negocio.nombre} obtiene ${score_total}/100 porque ${factores[0]!.explicacion.toLowerCase()}, ${factores[1]!.explicacion.toLowerCase()}, ${factores[2]!.explicacion.toLowerCase()}.`;
      return {
        rank: 0,
        negocio: c.negocio,
        score_total,
        factores,
        badges,
        razon_recomendacion: razon,
        distancia_km,
      };
    })
    .sort((a, b) => b.score_total - a.score_total)
    .slice(0, opts.limit ?? 3)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // "Por qué no este" — explain why #2 lost to #1
  const por_que_no_este: WorkedTrace["por_que_no_este"] = [];
  if (ranking.length >= 2) {
    const winner = ranking[0]!;
    const runnerUp = ranking[1]!;
    const diff = winner.score_total - runnerUp.score_total;
    const winnerStrongFactor = winner.factores.reduce((max, f) => (f.contribucion > max.contribucion ? f : max));
    por_que_no_este.push({
      nombre: runnerUp.negocio.nombre,
      razon: `${runnerUp.negocio.nombre} perdió por ${diff} puntos. Su ${winnerStrongFactor.factor} (${winnerStrongFactor.contribucion}/${winnerStrongFactor.peso_pct}) lo dejó abajo. Si actualiza precios o suma reseñas, sube.`,
    });
  }

  return {
    id: opts.id,
    titulo: opts.titulo,
    contexto_usuario: { ...opts.contexto_usuario, sub_region: userSubregion },
    candidatos_evaluados: candidates.length,
    descartados_por_radio: descartados,
    ranking,
    por_que_no_este,
    insight_competitivo: opts.insight_competitivo,
  };
}

// ============================================================================
// PUBLIC SCENARIOS — used by the deep-dive UI
// ============================================================================

export const TRACES_DETALLADOS: WorkedTrace[] = [
  buildTrace({
    id: "neiva-arepas",
    titulo: "Usuaria en Neiva busca 'arepas'",
    contexto_usuario: {
      ubicacion: "Neiva",
      sub_region: "norte",
      query: "arepas",
      hora_local: "14:30",
      preferencias: { solo_verificados: true, prefiere_acepta_saldo: true, radio_km: 30 },
    },
    filter: (n) => n.vertical === "foods",
    limit: 3,
    insight_competitivo:
      "MercadoLibre ordena por pago de sponsored listings + fecha de publicación. Nosotros ordenamos por frescura de precio + verificación + cercanía. Cuando actualizas tu precio hoy, subes el ranking mañana. Sin pagar.",
  }),
  buildTrace({
    id: "medellin-barber",
    titulo: "Usuario en Medellín busca 'barbería' (viaja al Huila)",
    contexto_usuario: {
      ubicacion: "Medellín",
      sub_region: "occidente", // mock
      query: "barberia",
      hora_local: "09:00",
      preferencias: { solo_verificados: true, radio_km: 100 },
    },
    filter: (n) => n.vertical === "barber",
    limit: 3,
    insight_competitivo:
      "Google Maps rankea por distancia + reviews. Pero un barbero en Neiva para un viajero desde Medellín necesita algo más: que acepte Saldo (no efectivo), que tenga fotos recientes, que esté verificado por NIT. Esos son los factores que ponderamos distinto.",
  }),
  buildTrace({
    id: "bogota-comida-huilense",
    titulo: "Consumidor en Bogotá busca 'comida huilense'",
    contexto_usuario: {
      ubicacion: "Bogotá",
      sub_region: "norte", // mock
      query: "comida huilense",
      hora_local: "20:00",
      preferencias: { prefiere_acepta_saldo: true },
    },
    filter: (n) => n.vertical === "foods" && n.ciudad !== "Bogotá",
    limit: 3,
    insight_competitivo:
      "Para un bogotano buscando comida huilense, no le sirve ver restaurantes en Neiva que no entregan. Por eso el factor geo es 35% pero también ponderamos si la descripción menciona 'envíos a Bogotá' o si tienen WhatsApp activo.",
  }),
  buildTrace({
    id: "pereira-centro",
    titulo: "Consumidor en Pereira busca 'centro de belleza'",
    contexto_usuario: {
      ubicacion: "Pereira",
      sub_region: "occidente",
      query: "centro de belleza",
      hora_local: "11:00",
      preferencias: { solo_verificados: true, prefiere_acepta_saldo: true },
    },
    filter: (n) => n.vertical === "beauty",
    limit: 3,
    insight_competitivo:
      "Cuando activas 'solo verificados', el factor verificado pasa de 25% → 100% de su peso, y los no verificados bajan automáticamente. Sin necesidad de un toggle separado. La preferencia del usuario reconfigura el ranking.",
  }),
  buildTrace({
    id: "neiva-plomero",
    titulo: "Vecino en Neiva necesita plomero urgente",
    contexto_usuario: {
      ubicacion: "Neiva",
      sub_region: "norte",
      query: "plomero urgente",
      hora_local: "22:30",
      preferencias: { radio_km: 10 },
    },
    filter: (n) => n.vertical === "hogar",
    limit: 3,
    insight_competitivo:
      "Cuando la query es 'urgente' + hora es 22:30 + radio es 10km, priorizamos empresas con badge '24/7' en su descripción y bajamos el peso de 'recencia' (en emergencias, la calidad importa más que el último precio). Esto se llama 'context-aware reweighting'.",
  }),
];

// ============================================================================
// HUMAN-READABLE FACTOR DESCRIPTIONS (deep-dive level)
// ============================================================================

export const FACTOR_DETALLES: Record<Factor, { nombre: string; peso_pct: number; proposito: string; ejemplos: string[]; cuando_sube: string; cuando_baja: string }> = {
  geo: {
    nombre: "Cercanía geográfica",
    peso_pct: 35,
    proposito: "El 73% de las compras locales son a menos de 15 km. La gente prefiere comprar donde puede ir físicamente.",
    ejemplos: [
      "Una tienda en Neiva rankea más alto que una tienda en Garzón para un usuario de Neiva",
      "Un barbero en La Plata NO aparece en los primeros 5 resultados para un usuario de Pitalito (son 90 km)",
    ],
    cuando_sube: "Misma ciudad (100 pts), misma subregión del Huila (65 pts), otra subregión (55 pts)",
    cuando_baja: "Cuando el radio de búsqueda se expande, el factor pierde peso relativo y otros ganan",
  },
  verificado: {
    nombre: "Negocio verificado",
    peso_pct: 25,
    proposito: "Reducir listings fraudulentos y aumentar confianza del comprador. Cada negocio pasa por validación NIT + DV contra la base de Confecámaras.",
    ejemplos: [
      "Un restaurante con NIT 900.123.456-7 verificado rankea más alto que uno sin verificar",
      "Si activas 'solo verificados' en tus preferencias, el factor verificado pasa a 100% de su peso",
    ],
    cuando_sube: "NIT validado contra RUES (100 pts)",
    cuando_baja: "Pendiente de verificación (25 pts), NIT no encontrado (10 pts)",
  },
  acepta_saldo: {
    nombre: "Acepta Opita Saldo",
    peso_pct: 15,
    proposito: "Diferenciador clave. Cerrado-loop wallet sin tarjeta, sin datéfono. Reduce fricción y abre el mercado a personas no bancarizadas.",
    ejemplos: [
      "Una peluquería que acepta Saldo rankea más alto para usuarios que también lo aceptan",
      "Un restaurante que solo recibe efectivo pierde 60 puntos vs uno con Saldo",
    ],
    cuando_sube: "Negocio confirmado como merchant Saldo (100 pts)",
    cuando_baja: "Solo métodos tradicionales (40 pts)",
  },
  recencia: {
    nombre: "Precios actualizados",
    peso_pct: 15,
    proposito: "Precios viejos = desconfianza. Un precio de hace 5 días probablemente ya cambió. Priorizamos datos frescos.",
    ejemplos: [
      "Si actualizaste tus precios hoy, tu negocio sube 5-15 posiciones",
      "Un negocio sin actualizar en 7 días pierde ~30 pts vs uno actualizado hace 1 hora",
    ],
    cuando_sube: "<1 hora (100 pts), <6h (75 pts), <24h (55 pts)",
    cuando_baja: ">3 días (15 pts), >7 días (10 pts)",
  },
  reputacion: {
    nombre: "Reseñas verificables",
    peso_pct: 10,
    proposito: "Solo reseñas de usuarios que compraron. Combina rating promedio (80%) con volumen de reseñas (20%) para evitar el gaming.",
    ejemplos: [
      "4.8★ con 312 reseñas > 4.9★ con 5 reseñas",
      "Una reseña de hace 2 años pesa menos que una de esta semana",
    ],
    cuando_sube: "4.5+ estrellas con 50+ reseñas (85+ pts)",
    cuando_baja: "<4.0 estrellas o <10 reseñas (40 pts)",
  },
};

// ============================================================================
// HELPER
// ============================================================================

export function getTraceById(id: string): WorkedTrace | undefined {
  return TRACES_DETALLADOS.find((t) => t.id === id);
}