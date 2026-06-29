/**
 * Opita Market — Investor Demo Data
 *
 * Synthetic but realistic data for the investor demo at /demo/*. All business
 * names, NITs, addresses, and prices are FICTIONAL — explicitly labeled as
 * "datos de demostración" in the UI per colombia-conventions skill (no deception,
 * SIC compliance).
 *
 * Pair with opita-frontend-behavior for Cialdini/Fogg/SDT patterns applied here.
 */

export type VerticalSlug = "foods" | "barber" | "beauty" | "hogar";

export interface Vertical {
  slug: VerticalSlug;
  nombre: string;
  subtitulo: string;
  descripcion: string;
  emoji: string;
  colorAccent: "brand" | "accent" | "sky" | "warning";
  /** Sample categories within this vertical. */
  categorias: string[];
  /** Default CTA copy per vertical (Cialdini: clarity over cleverness). */
  ctaPrimario: string;
  /** Social proof badge text. */
  pruebaSocial: string;
}

export const VERTICALES: Record<VerticalSlug, Vertical> = {
  foods: {
    slug: "foods",
    nombre: "Opita Foods",
    subtitulo: "Restaurantes + supply B2B como Frubana",
    descripcion:
      "Pide a restaurantes del Huila por WhatsApp o compara precios mayoristas de productos frescos para tu negocio. Sin datáfono, sin tarjeta.",
    emoji: "🍲",
    colorAccent: "brand",
    categorias: ["Restaurantes", "Cafés", "Panaderías", "Frutas y verduras", "Cárnicos"],
    ctaPrimario: "Explorar restaurantes",
    pruebaSocial: "342 locales en el Huila",
  },
  barber: {
    slug: "barber",
    nombre: "Opita Barber",
    subtitulo: "Barberías del Huila, cerca de ti",
    descripcion:
      "Encuentra la barbería más cercana con servicios claros y precios publicados. Reserva por WhatsApp sin complicarte.",
    emoji: "💈",
    colorAccent: "sky",
    categorias: ["Barberías", "Corte caballero", "Barba", "Tintes"],
    ctaPrimario: "Ver barberías cerca",
    pruebaSocial: "128 barberías registradas",
  },
  beauty: {
    slug: "beauty",
    nombre: "Opita Beauty",
    subtitulo: "Centros de belleza femenina del Huila",
    descripcion:
      "Salones, manicura, spa, maquillaje. Precios publicados, fotos reales, agendá por WhatsApp con la manicurista de confianza.",
    emoji: "💄",
    colorAccent: "accent",
    categorias: ["Salones", "Manicura y pedicura", "Maquillaje", "Spa", "Tratamientos capilares"],
    ctaPrimario: "Ver centros de belleza",
    pruebaSocial: "256 centros verificados",
  },
  hogar: {
    slug: "hogar",
    nombre: "Opita Hogar",
    subtitulo: "Servicios para el hogar en el Huila",
    descripcion:
      "Fontanería, electricidad, albañilería, limpieza. Profesionales locales con precios justos y reseñas verificables.",
    emoji: "🏠",
    colorAccent: "warning",
    categorias: ["Fontanería", "Electricidad", "Albañilería", "Limpieza", "Jardinería"],
    ctaPrimario: "Encontrar profesional",
    pruebaSocial: "94 profesionales activos",
  },
};

export interface DemoProducto {
  nombre: string;
  precio_cop: number;
  unidad: string;
  categoria: string;
}

export type TierNegocio = "reclamado" | "visible" | "premium";

export interface DemoNegocio {
  slug: string;
  nombre: string;
  vertical: VerticalSlug;
  /** 1-line tagline shown in cards. */
  tagline: string;
  descripcion: string;
  ciudad: string;
  departamento: string;
  barrio: string;
  /** Verificado means RUES + NIT check passed. */
  verificado: boolean;
  /** Whether the business accepts Opita Saldo (closed-loop wallet). */
  acepta_saldo: boolean;
  /** WhatsApp number in Colombian format (E.164 stripped of +). */
  whatsapp_e164: string;
  rating: number; // 0-5, with one decimal
  reviews_count: number;
  tier: TierNegocio;
  categorias_tags: string[];
  productos_destacados: DemoProducto[];
  /** Display string for hours. */
  horario: string;
  /** When the price data was last updated (human-readable). */
  precio_actualizado: string;
  /** Cover image — empty string means placeholder gradient. */
  imagen: string;
}

// ============================================================================
// 20 sample businesses: 5 per vertical. Synthetic, realistic Huila data.
// ============================================================================

export const NEGOCIOS: DemoNegocio[] = [
  // --- Opita Foods (5) ---
  {
    slug: "asadero-el-tamayo",
    nombre: "Asadero El Tamayo",
    vertical: "foods",
    tagline: "Lechona y asados desde 1987",
    descripcion:
      "Familia Tamayo sirviendo la mejor lechona del Huila hace 37 años. Asados los fines de semana, caldo de pajarilla los domingos.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Centro",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573001234567",
    rating: 4.7,
    reviews_count: 312,
    tier: "premium",
    categorias_tags: ["Restaurantes", "Asados", "Lechona"],
    productos_destacados: [
      { nombre: "Lechona por libra", precio_cop: 38000, unidad: "libra", categoria: "Platos" },
      { nombre: "Caldo de pajarilla", precio_cop: 18000, unidad: "porción", categoria: "Platos" },
      { nombre: "Asado Huilense (bandeja)", precio_cop: 35000, unidad: "bandeja", categoria: "Platos" },
    ],
    horario: "Mar-Dom 11:00-21:00",
    precio_actualizado: "hace 2 horas",
    imagen: "",
  },
  {
    slug: "café-abeja-andina",
    nombre: "Café Abeja Andina",
    vertical: "foods",
    tagline: "Café de origen Pitalito, tostado en Neiva",
    descripcion:
      "Tostamos café de la asociación de productores de Pitalito. Variedad Castillo y Caturra, microlotes con trazabilidad por finca.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Altico",
    verificado: true,
    acepta_saldo: false,
    whatsapp_e164: "573112345678",
    rating: 4.9,
    reviews_count: 198,
    tier: "premium",
    categorias_tags: ["Cafés", "Café de origen"],
    productos_destacados: [
      { nombre: "Café microlote 250g", precio_cop: 28000, unidad: "bolsa", categoria: "Café" },
      { nombre: "Café diario 500g", precio_cop: 42000, unidad: "bolsa", categoria: "Café" },
      { nombre: "Cata de café para 2", precio_cop: 35000, unidad: "sesión", categoria: "Experiencia" },
    ],
    horario: "Lun-Sáb 8:00-19:00",
    precio_actualizado: "hace 45 minutos",
    imagen: "",
  },
  {
    slug: "frutas-doña-marta",
    nombre: "Frutas Doña Marta",
    vertical: "foods",
    tagline: "Frutas y verduras frescas del campo a tu mesa",
    descripcion:
      "Marta recibe producto de 6 municipios del Huila cada martes y viernes. Precios de plaza mayorista con delivery al hogar.",
    ciudad: "Pitalito",
    departamento: "Huila",
    barrio: "Centro",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573157894561",
    rating: 4.6,
    reviews_count: 87,
    tier: "visible",
    categorias_tags: ["Frutas y verduras", "Plaza"],
    productos_destacados: [
      { nombre: "Tomate de árbol (kilo)", precio_cop: 6500, unidad: "kilo", categoria: "Frutas" },
      { nombre: "Lulo fresco (kilo)", precio_cop: 8500, unidad: "kilo", categoria: "Frutas" },
      { nombre: "Aguacate Hass (kilo)", precio_cop: 12000, unidad: "kilo", categoria: "Frutas" },
      { nombre: "Papa pastusa (bulto 50kg)", precio_cop: 95000, unidad: "bulto", categoria: "Tubérculos" },
    ],
    horario: "Mar-Vie 6:00-15:00, Sáb 6:00-12:00",
    precio_actualizado: "hace 1 hora",
    imagen: "",
  },
  {
    slug: "panaderia-trigo-de-oro",
    nombre: "Panadería Trigo de Oro",
    vertical: "foods",
    tagline: "Pan artesanal horneado desde las 4am",
    descripcion:
      "Tres generaciones horneando pan de masa madre en Garzón. Amasijos, pan de yuca, rosquillas. Hacemos domicilio al barrio.",
    ciudad: "Garzón",
    departamento: "Huila",
    barrio: "Centro",
    verificado: false,
    acepta_saldo: true,
    whatsapp_e164: "573224567890",
    rating: 4.5,
    reviews_count: 54,
    tier: "visible",
    categorias_tags: ["Panaderías", "Pan artesanal"],
    productos_destacados: [
      { nombre: "Pan de masa madre (250g)", precio_cop: 8500, unidad: "unidad", categoria: "Pan" },
      { nombre: "Amasijo de Maíz (unidad)", precio_cop: 3500, unidad: "unidad", categoria: "Amasijos" },
      { nombre: "Rosquillas (docena)", precio_cop: 12000, unidad: "docena", categoria: "Amasijos" },
    ],
    horario: "Lun-Sáb 5:30-19:00, Dom 6:00-12:00",
    precio_actualizado: "hace 4 horas",
    imagen: "",
  },
  {
    slug: "asados-la-villa",
    nombre: "Asados La Villa",
    vertical: "foods",
    tagline: "Parrilla al carbón con vista al Magdalena",
    descripcion:
      "Restaurante familiar en Rivera con especialidad en costilla, pechuga y chorizo. Música en vivo los sábados.",
    ciudad: "Rivera",
    departamento: "Huila",
    barrio: "Vereda La Ulloa",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573002345678",
    rating: 4.8,
    reviews_count: 421,
    tier: "premium",
    categorias_tags: ["Restaurantes", "Asados", "Parrilla"],
    productos_destacados: [
      { nombre: "Costilla BBQ por libra", precio_cop: 32000, unidad: "libra", categoria: "Carnes" },
      { nombre: "Pechuga asada (bandeja)", precio_cop: 28000, unidad: "bandeja", categoria: "Carnes" },
      { nombre: "Chorizo artesanal (5 und)", precio_cop: 22000, unidad: "porción", categoria: "Carnes" },
    ],
    horario: "Jue-Dom 12:00-22:00",
    precio_actualizado: "hace 30 minutos",
    imagen: "",
  },

  // --- Opita Barber (5) ---
  {
    slug: "barberia-el-poblado",
    nombre: "Barbería El Poblado",
    vertical: "barber",
    tagline: "Corte clásico + navaja, tradición desde 1992",
    descripcion:
      "Tres sillones, música de los 90, café mientras esperás. Don Pedro y su hijo atienden de lunes a sábado.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "El Poblado",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573005678901",
    rating: 4.8,
    reviews_count: 234,
    tier: "premium",
    categorias_tags: ["Barberías", "Corte caballero", "Barba"],
    productos_destacados: [
      { nombre: "Corte caballero", precio_cop: 18000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Barba con navaja", precio_cop: 12000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Combo corte + barba", precio_cop: 28000, unidad: "servicio", categoria: "Servicios" },
    ],
    horario: "Lun-Sáb 9:00-20:00",
    precio_actualizado: "hace 1 día",
    imagen: "",
  },
  {
    slug: "studio-rm-barber",
    nombre: "Studio RM Barber",
    vertical: "barber",
    tagline: "Diseño de cejas, fade y color para caballero",
    descripcion:
      "Estudio moderno con énfasis en diseño y color. Trabajamos con citas para que no esperes.",
    ciudad: "Pitalito",
    departamento: "Huila",
    barrio: "Centro",
    verificado: true,
    acepta_saldo: false,
    whatsapp_e164: "573147891234",
    rating: 4.7,
    reviews_count: 156,
    tier: "visible",
    categorias_tags: ["Barberías", "Corte caballero", "Tintes"],
    productos_destacados: [
      { nombre: "Fade premium", precio_cop: 25000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Diseño de cejas", precio_cop: 10000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Color caballero", precio_cop: 45000, unidad: "servicio", categoria: "Servicios" },
    ],
    horario: "Mar-Sáb 10:00-21:00",
    precio_actualizado: "hace 2 días",
    imagen: "",
  },
  {
    slug: "la-meca-barbershop",
    nombre: "La Meca Barbershop",
    vertical: "barber",
    tagline: "Cortes urbanos, ambiente deportivo",
    descripcion:
      "Cortes clásicos y modernos, pantalla gigante para ver fútbol mientras te atienden. Estacionamiento propio.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "San Pedro",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573108765432",
    rating: 4.6,
    reviews_count: 89,
    tier: "reclamado",
    categorias_tags: ["Barberías", "Corte caballero"],
    productos_destacados: [
      { nombre: "Corte clásico", precio_cop: 15000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Corte + diseño", precio_cop: 22000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Niño (hasta 12 años)", precio_cop: 12000, unidad: "servicio", categoria: "Servicios" },
    ],
    horario: "Lun-Dom 10:00-22:00",
    precio_actualizado: "hace 3 días",
    imagen: "",
  },
  {
    slug: "tijeras-de-oro",
    nombre: "Tijeras de Oro",
    vertical: "barber",
    tagline: "Barbería tradicional en La Plata",
    descripcion:
      "Don Álvaro y 40 años de experiencia. Corte con tijera, navaja caliente, ambiente familiar.",
    ciudad: "La Plata",
    departamento: "Huila",
    barrio: "Centro",
    verificado: false,
    acepta_saldo: false,
    whatsapp_e164: "573223456789",
    rating: 4.5,
    reviews_count: 67,
    tier: "reclamado",
    categorias_tags: ["Barberías", "Corte caballero"],
    productos_destacados: [
      { nombre: "Corte con tijera", precio_cop: 16000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Navaja caliente", precio_cop: 14000, unidad: "servicio", categoria: "Servicios" },
    ],
    horario: "Lun-Sáb 8:00-19:00",
    precio_actualizado: "hace 5 días",
    imagen: "",
  },
  {
    slug: "the-gentlemans-cut",
    nombre: "The Gentleman's Cut",
    vertical: "barber",
    tagline: "Barbería premium, experiencia VIP",
    descripcion:
      "Servicio con reserva, trago incluido, productos importados. Para el caballero que busca un momento.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Los Alpes",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573009876543",
    rating: 4.9,
    reviews_count: 78,
    tier: "premium",
    categorias_tags: ["Barberías", "Corte caballero", "Barba"],
    productos_destacados: [
      { nombre: "Corte + spa barba", precio_cop: 65000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Servicio premium completo", precio_cop: 95000, unidad: "servicio", categoria: "Servicios" },
    ],
    horario: "Mar-Sáb 11:00-21:00",
    precio_actualizado: "hace 12 horas",
    imagen: "",
  },

  // --- Opita Beauty (5) ---
  {
    slug: "salon-maria-estetica",
    nombre: "María Estética Integral",
    vertical: "beauty",
    tagline: "Spa + manicura + tratamientos faciales",
    descripcion:
      "María y su equipo llevan 12 años atendiendo en Neiva. Productos veganos, ambiente tranquilo, agendamiento fácil.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Las Acacias",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573001237894",
    rating: 4.9,
    reviews_count: 567,
    tier: "premium",
    categorias_tags: ["Salones", "Manicura y pedicura", "Spa", "Tratamientos capilares"],
    productos_destacados: [
      { nombre: "Manicura + diseño", precio_cop: 28000, unidad: "servicio", categoria: "Uñas" },
      { nombre: "Pedicura spa", precio_cop: 35000, unidad: "servicio", categoria: "Uñas" },
      { nombre: "Tratamiento facial profundo", precio_cop: 75000, unidad: "sesión", categoria: "Facial" },
      { nombre: "Keratina (cabello medio)", precio_cop: 180000, unidad: "sesión", categoria: "Cabello" },
    ],
    horario: "Lun-Sáb 9:00-19:00",
    precio_actualizado: "hace 1 día",
    imagen: "",
  },
  {
    slug: "uñas-de-suenos",
    nombre: "Uñas de Sueños",
    vertical: "beauty",
    tagline: "Especialistas en uñas esculpidas y arte",
    descripcion:
      "3 manicuristas expertas en técnicas coreanas y brasileñas. Trabajamos con gel, acrílico y polygel.",
    ciudad: "Pitalito",
    departamento: "Huila",
    barrio: "Centro",
    verificado: true,
    acepta_saldo: false,
    whatsapp_e164: "573157891237",
    rating: 4.8,
    reviews_count: 234,
    tier: "visible",
    categorias_tags: ["Manicura y pedicura", "Uñas esculpidas"],
    productos_destacados: [
      { nombre: "Uñas acrílico (largo)", precio_cop: 75000, unidad: "servicio", categoria: "Uñas" },
      { nombre: "Gel + diseño", precio_cop: 45000, unidad: "servicio", categoria: "Uñas" },
      { nombre: "Retoque mensual", precio_cop: 35000, unidad: "servicio", categoria: "Uñas" },
    ],
    horario: "Mar-Sáb 10:00-20:00",
    precio_actualizado: "hace 8 horas",
    imagen: "",
  },
  {
    slug: "studio-makeup-pro",
    nombre: "Studio Makeup Pro",
    vertical: "beauty",
    tagline: "Maquillaje profesional para novias y eventos",
    descripcion:
      "Paquetes de novia, quinceañeras, eventos corporativos. Desplazamiento a domicilio en Neiva y Pitalito.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "El Vergel",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573112345987",
    rating: 4.9,
    reviews_count: 145,
    tier: "premium",
    categorias_tags: ["Maquillaje", "Eventos", "Novias"],
    productos_destacados: [
      { nombre: "Maquillaje social", precio_cop: 120000, unidad: "sesión", categoria: "Maquillaje" },
      { nombre: "Novia (incluye prueba)", precio_cop: 380000, unidad: "paquete", categoria: "Maquillaje" },
      { nombre: "Quinceañera", precio_cop: 180000, unidad: "sesión", categoria: "Maquillaje" },
    ],
    horario: "Con cita previa",
    precio_actualizado: "hace 2 días",
    imagen: "",
  },
  {
    slug: "spa-relax-andino",
    nombre: "Spa Relax Andino",
    vertical: "beauty",
    tagline: "Masajes y tratamientos corporales",
    descripcion:
      "Masajes relajantes, descontracturantes, tratamientos reductores. Ambiente con vista a los Andes.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Calambeo",
    verificado: false,
    acepta_saldo: true,
    whatsapp_e164: "573157894123",
    rating: 4.7,
    reviews_count: 98,
    tier: "visible",
    categorias_tags: ["Spa", "Masajes"],
    productos_destacados: [
      { nombre: "Masaje relajante 60min", precio_cop: 85000, unidad: "sesión", categoria: "Masajes" },
      { nombre: "Masaje descontracturante 60min", precio_cop: 95000, unidad: "sesión", categoria: "Masajes" },
      { nombre: "Tratamiento reductor", precio_cop: 180000, unidad: "sesión", categoria: "Corporal" },
    ],
    horario: "Lun-Sáb 9:00-20:00",
    precio_actualizado: "hace 3 días",
    imagen: "",
  },
  {
    slug: "cejas-y-mas",
    nombre: "Cejas y Más",
    vertical: "beauty",
    tagline: "Diseño de cejas, pestañas y microblading",
    descripcion:
      "Especialistas en visagismo. Laminado de cejas, extensiones de pestañas, microblading con cita previa.",
    ciudad: "Garzón",
    departamento: "Huila",
    barrio: "Centro",
    verificado: true,
    acepta_saldo: false,
    whatsapp_e164: "573224561234",
    rating: 4.8,
    reviews_count: 67,
    tier: "reclamado",
    categorias_tags: ["Cejas y pestañas", "Microblading"],
    productos_destacados: [
      { nombre: "Diseño de cejas", precio_cop: 25000, unidad: "servicio", categoria: "Cejas" },
      { nombre: "Laminado de cejas", precio_cop: 65000, unidad: "servicio", categoria: "Cejas" },
      { nombre: "Microblading", precio_cop: 280000, unidad: "sesión", categoria: "Cejas" },
      { nombre: "Extensiones pelo a pelo", precio_cop: 120000, unidad: "sesión", categoria: "Pestañas" },
    ],
    horario: "Mar-Sáb 10:00-19:00",
    precio_actualizado: "hace 4 días",
    imagen: "",
  },

  // --- Opita Hogar (5) ---
  {
    slug: "plomeria-rivera-huila",
    nombre: "Plomería Rivera Huila",
    vertical: "hogar",
    tagline: "Servicio 24/7, llegamos en 30 minutos",
    descripcion:
      "Don Jairo y su equipo atienden emergencias y arreglos programados. Presupuesto sin compromiso.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Las Américas",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573001239876",
    rating: 4.7,
    reviews_count: 234,
    tier: "premium",
    categorias_tags: ["Fontanería", "Emergencias 24/7"],
    productos_destacados: [
      { nombre: "Visita + diagnóstico", precio_cop: 45000, unidad: "visita", categoria: "Servicios" },
      { nombre: "Destape de cañería", precio_cop: 120000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Reparación fuga", precio_cop: 95000, unidad: "servicio", categoria: "Servicios" },
    ],
    horario: "Lun-Dom 24h (emergencias)",
    precio_actualizado: "hace 2 días",
    imagen: "",
  },
  {
    slug: "electricistas-del-sur",
    nombre: "Electricistas del Sur",
    vertical: "hogar",
    tagline: "Instalaciones residenciales y comerciales",
    descripcion:
      "Equipo certificado RETIE. Trabajamos en Neiva, Pitalito y Garzón. Garantía escrita por escrito.",
    ciudad: "Pitalito",
    departamento: "Huila",
    barrio: "San Antonio",
    verificado: true,
    acepta_saldo: true,
    whatsapp_e164: "573147895678",
    rating: 4.8,
    reviews_count: 167,
    tier: "premium",
    categorias_tags: ["Electricidad", "Certificación RETIE"],
    productos_destacados: [
      { nombre: "Visita técnica", precio_cop: 50000, unidad: "visita", categoria: "Servicios" },
      { nombre: "Instalación toma/corriente", precio_cop: 65000, unidad: "servicio", categoria: "Servicios" },
      { nombre: "Certificación RETIE (vivienda)", precio_cop: 350000, unidad: "servicio", categoria: "Servicios" },
    ],
    horario: "Lun-Sáb 7:00-18:00",
    precio_actualizado: "hace 1 día",
    imagen: "",
  },
  {
    slug: "albanileria-los-andes",
    nombre: "Albañilería Los Andes",
    vertical: "hogar",
    tagline: "Construcción y remodelaciones en el Huila",
    descripcion:
      "15 años de experiencia. Remodelación de cocinas, baños, fachadas. Presupuesto en 48 horas.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Siete de Agosto",
    verificado: false,
    acepta_saldo: true,
    whatsapp_e164: "573112349876",
    rating: 4.6,
    reviews_count: 89,
    tier: "visible",
    categorias_tags: ["Albañilería", "Remodelación"],
    productos_destacados: [
      { nombre: "Visita + presupuesto", precio_cop: 35000, unidad: "visita", categoria: "Servicios" },
      { nombre: "Remodelación baño (básico)", precio_cop: 2500000, unidad: "proyecto", categoria: "Proyectos" },
      { nombre: "Enchape m²", precio_cop: 85000, unidad: "m²", categoria: "Proyectos" },
    ],
    horario: "Lun-Sáb 7:00-17:00",
    precio_actualizado: "hace 4 días",
    imagen: "",
  },
  {
    slug: "limpieza-pro-huila",
    nombre: "Limpieza Pro Huila",
    vertical: "hogar",
    tagline: "Servicio de limpieza residencial y oficinas",
    descripcion:
      "Equipo con experiencia y productos incluidos. Servicio por horas, semanal o mensual.",
    ciudad: "Neiva",
    departamento: "Huila",
    barrio: "Cándido Leguízamo",
    verificado: true,
    acepta_saldo: false,
    whatsapp_e164: "573001231234",
    rating: 4.7,
    reviews_count: 134,
    tier: "visible",
    categorias_tags: ["Limpieza", "Residencial", "Oficinas"],
    productos_destacados: [
      { nombre: "Limpieza profunda (4h)", precio_cop: 120000, unidad: "visita", categoria: "Servicios" },
      { nombre: "Limpieza semanal (3h)", precio_cop: 95000, unidad: "visita", categoria: "Servicios" },
      { nombre: "Limpieza oficina (8h)", precio_cop: 180000, unidad: "visita", categoria: "Servicios" },
    ],
    horario: "Lun-Sáb 7:00-19:00",
    precio_actualizado: "hace 6 horas",
    imagen: "",
  },
  {
    slug: "jardines-del-opita",
    nombre: "Jardines del Opita",
    vertical: "hogar",
    tagline: "Diseño, mantenimiento y paisajismo",
    descripcion:
      "Don Guillermo crea y mantiene jardines para casas y conjuntos residenciales. Visita gratis para presupuestos.",
    ciudad: "Rivera",
    departamento: "Huila",
    barrio: "Vereda El Cedral",
    verificado: false,
    acepta_saldo: true,
    whatsapp_e164: "573002341234",
    rating: 4.5,
    reviews_count: 45,
    tier: "reclamado",
    categorias_tags: ["Jardinería", "Paisajismo"],
    productos_destacados: [
      { nombre: "Visita + diseño", precio_cop: 0, unidad: "visita", categoria: "Servicios" },
      { nombre: "Mantenimiento mensual", precio_cop: 180000, unidad: "mes", categoria: "Servicios" },
      { nombre: "Diseño jardín (proyecto)", precio_cop: 850000, unidad: "proyecto", categoria: "Proyectos" },
    ],
    horario: "Lun-Sáb 7:00-16:00",
    precio_actualizado: "hace 5 días",
    imagen: "",
  },
];

// ============================================================================
// Price Board — Opita Foods B2B (synthetic but plausible wholesale prices)
// ============================================================================

export interface PriceBoardEntry {
  producto: string;
  categoria: string;
  precio_min_cop: number;
  precio_max_cop: number;
  promedio_cop: number;
  ciudad_referencia: string;
  vendors_count: number;
  trend: "up" | "down" | "stable";
  trend_pct: number;
  actualizado: string;
}

export const PRICE_BOARD: PriceBoardEntry[] = [
  {
    producto: "Tomate de árbol (kilo)",
    categoria: "Frutas",
    precio_min_cop: 5800,
    precio_max_cop: 7500,
    promedio_cop: 6500,
    ciudad_referencia: "Neiva",
    vendors_count: 23,
    trend: "up",
    trend_pct: 8.3,
    actualizado: "hace 1 hora",
  },
  {
    producto: "Lulo fresco (kilo)",
    categoria: "Frutas",
    precio_min_cop: 7500,
    precio_max_cop: 9500,
    promedio_cop: 8500,
    ciudad_referencia: "Neiva",
    vendors_count: 18,
    trend: "down",
    trend_pct: -4.2,
    actualizado: "hace 1 hora",
  },
  {
    producto: "Aguacate Hass (kilo)",
    categoria: "Frutas",
    precio_min_cop: 10500,
    precio_max_cop: 13500,
    promedio_cop: 12000,
    ciudad_referencia: "Neiva",
    vendors_count: 15,
    trend: "stable",
    trend_pct: 0.5,
    actualizado: "hace 2 horas",
  },
  {
    producto: "Papa pastusa (bulto 50kg)",
    categoria: "Tubérculos",
    precio_min_cop: 88000,
    precio_max_cop: 102000,
    promedio_cop: 95000,
    ciudad_referencia: "Pitalito",
    vendors_count: 9,
    trend: "up",
    trend_pct: 12.1,
    actualizado: "hace 3 horas",
  },
  {
    producto: "Café pergamino seco (kilo)",
    categoria: "Café",
    precio_min_cop: 18000,
    precio_max_cop: 22500,
    promedio_cop: 20000,
    ciudad_referencia: "Pitalito",
    vendors_count: 7,
    trend: "stable",
    trend_pct: 1.2,
    actualizado: "hace 6 horas",
  },
  {
    producto: "Carne de res (libra)",
    categoria: "Cárnicos",
    precio_min_cop: 21000,
    precio_max_cop: 26000,
    promedio_cop: 23500,
    ciudad_referencia: "Neiva",
    vendors_count: 12,
    trend: "down",
    trend_pct: -2.8,
    actualizado: "hace 4 horas",
  },
  {
    producto: "Pollo entero (kilo)",
    categoria: "Cárnicos",
    precio_min_cop: 13500,
    precio_max_cop: 16800,
    promedio_cop: 15200,
    ciudad_referencia: "Garzón",
    vendors_count: 8,
    trend: "up",
    trend_pct: 5.7,
    actualizado: "hace 2 horas",
  },
  {
    producto: "Leche cruda (litro)",
    categoria: "Lácteos",
    precio_min_cop: 2800,
    precio_max_cop: 3500,
    promedio_cop: 3100,
    ciudad_referencia: "La Plata",
    vendors_count: 6,
    trend: "stable",
    trend_pct: 0,
    actualizado: "hace 5 horas",
  },
];

// ============================================================================
// Helpers — used by pages
// ============================================================================

export function getNegocio(slug: string): DemoNegocio | undefined {
  return NEGOCIOS.find((n) => n.slug === slug);
}

export function getNegociosByVertical(vertical: VerticalSlug): DemoNegocio[] {
  return NEGOCIOS.filter((n) => n.vertical === vertical);
}

export function getRandomNegociosByVertical(vertical: VerticalSlug, count: number): DemoNegocio[] {
  const all = getNegociosByVertical(vertical);
  // Stable selection by seed (no randomness for SSR consistency).
  return all.slice(0, count);
}

/**
 * Format COP price the colombia-conventions way:
 * "$ 1.234.567" (no decimals, period thousands, NBSP after $).
 */
export function formatCOP(value: number): string {
  if (value === 0) return "Gratis";
  const formatted = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace(/\u00A0/g, " "); // replace NBSP with regular space for HTML safety
  return formatted;
}

/** Tier badge label per tier. */
export function tierLabel(tier: TierNegocio): string {
  switch (tier) {
    case "premium":
      return "Premium";
    case "visible":
      return "Verificado";
    case "reclamado":
      return "Reclamado";
  }
}

/** Tier badge description (tooltip). */
export function tierDescripcion(tier: TierNegocio): string {
  switch (tier) {
    case "premium":
      return "Negocio con plan Premium: información destacada, productos actualizados, atención prioritaria.";
    case "visible":
      return "Negocio verificado por RUES con plan Visible: aparece en búsquedas, datos públicos correctos.";
    case "reclamado":
      return "Dueño reclamó el perfil pero aún no completa verificación NIT. Información básica.";
  }
}