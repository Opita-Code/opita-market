# LinkedIn Post — Pentest Pre-Deploy + Promoción darkagents.opitacode.com

**Para:** @nicourrutia83
**Longitud:** ~1,500 palabras (LinkedIn long-form)
**Tono:** auténtico, técnico pero accesible, sin autobombo
**Objetivo:** mostrar trabajo real + posicionar darkagents.opitacode.com como plataforma seria de agentes de IA para security
**Hashtags:** #Pentest #SecurityAudit #Fintech #AI #DevSecOps #Colombia #CyberSecurity #AITools #PaymentGateway

---

## 📋 COPY-READY (copia y pega tal cual)

---

A 7 días de lanzar Opita Pagos, nuestra pasarela de pagos para el mercado rural colombiano, hicimos algo que el 95% de las fintechs no hace: **intentamos romper nuestro propio sistema antes de poner dinero real de personas en juego**.

No contratamos un auditor externo (todavía no). Lo que hicimos fue correr un pentest automatizado contra nuestro propio código, con agentes de IA especializados ejecutando la misma metodología que usaría un adversary工程师 real.

El resultado nos hizo sentarnos 30 minutos a tomar café con cara larga antes de empezar a planear la remediación.

Aquí va la historia. 👇

---

**El contexto:**

Opita Pagos procesa pesos colombianos. Usuarios rurales. Closed-loop wallet (1:1 COP). Wompi como procesador (Bre-B + tarjetas). 5 tiers de usuario. 12 endpoints en producción. 6 crons. Compliance con Ley 1581, Decreto 222/2020, Estatuto 1480, UIAF, SIC.

En otras palabras: dinero real de personas reales, expuesto a la internet pública. Si metíamos la pata, no era un "bug" — era una familia que perdía sus ahorros.

**La decisión:**

Tres semanas antes del launch, decidimos correr un pentest completo del producto. No parcial. No "una revisión de código". Completo. OWASP Top 10:2025. CWE Top 25. MITRE ATT&CK v19. STRIDE por componente. PCI-DSS. Y todo el marco regulatorio colombiano.

Para eso, usamos **darkagents.opitacode.com** — la plataforma que hemos estado construyendo para que agentes de IA especializados ejecuten tareas de security research de forma seria. (Disclaimer: yo trabajo en esto. Pero los datos son los datos.)

Lanzamos 8 agentes en paralelo, cada uno con un scope distinto:
- 3 agentes para revisar código (lib, API, frontend)
- 1 agente para mapeo de superficie + CVE scan de dependencias
- 1 agente para privilege escalation en AWS
- 1 agente para fraude de pagos (BIN attacks, 3DS bypass, mule patterns)
- 1 agente para secret scanning en git history
- 1 agente para compliance con ley colombiana + OWASP LLM Top 10

5 días. 50 archivos auditados. ~4,500 líneas de código. 11 frameworks aplicados.

---

**Los números** (y esto es lo que nos asustó):

| Severidad | Hallazgos |
|---|---|
| 🔴 CRITICAL | 20 |
| 🟠 HIGH | 22 |
| 🟡 MEDIUM | 25 |
| 🔵 LOW | 17 |
| ℹ️ INFO | 3 |
| **Total** | **87** |

De los 20 CRITICAL, **22 son production-blockers** (no podemos lanzar a producción sin arreglarlos primero) y **5 son compliance blockers** (vulnerabilidades regulatorias que nos exponen a sanciones de la SIC y la UIAF).

El veredicto del pentest: 🔴 **NO-GO** para producción.

---

**Los 3 hallazgos que más nos asustaron:**

**1. Webhook replay attacks (CVSS 9.1)**

El endpoint que recibe notificaciones de Wompi cuando alguien paga con tarjeta **verificaba la firma criptográfica correctamente, pero NUNCA validaba el timestamp**.

Eso significa: cualquier atacante que interceptara un webhook válido podía reenviarlo 1 millón de veces. Cada reenvío acreditaba la wallet del usuario. **Máquina de imprimir dinero, literalmente.**

Tiempo de exploit: 5 minutos. Remediación: 5 líneas de código.

**2. SSRF via evidencia de entrega (CVSS 9.0)**

Cuando un vendedor confirma una entrega de más de $1 millón de COP, debe subir una foto de evidencia. El sistema aceptaba cualquier URL sin validar.

Un vendedor malicioso podía enviar como "foto" esta URL: `http://169.254.169.254/latest/meta-data/iam/security-credentials/`

Esa es la dirección IP que todas las máquinas de AWS tienen para acceder a sus propios metadatos. Cuando el DPO abría la "foto de evidencia" en su navegador, **le filtraba las credenciales IAM de la Lambda**. Acceso completo a la cuenta de AWS.

**Tiempo de exploit: 15 minutos. Pérdida potencial: total.**

**3. JWT secret en el bundle del cliente (CVSS 9.3)**

En el archivo `.env.local` del frontend, el JWT signing secret estaba guardado como `PUBLIC_JWT_SECRET` y declarado en `env.d.ts`.

El problema: **Astro/Vite expone TODAS las variables de `import.meta.env` al bundle de JavaScript que se envía al navegador.** El atacante abre el código fuente del sitio, busca `JWT_SECRET`, encuentra el valor, y ahora puede firmar cualquier JWT con la clave secreta del sistema.

Resultado: impersonar a cualquier usuario, incluyendo al DPO. Acceder a datos de cualquier usuario. Iniciar y aprobar cualquier transacción.

Remediación: 1 hora. Pero el susto fue de 30 minutos.

---

**Lo que esto demuestra (y por qué te lo cuento)**:

**El TDD no es suficiente.**

Los 7 Pull Requests anteriores pasaron con 311 tests y 95% de cobertura. El TDD nos ahorró docenas de bugs. Pero hay categorías enteras de problemas que el TDD no puede ver:

- **Race conditions** en DynamoDB (TOCTOU entre read y conditional write)
- **Secrets en .env** (Wompi production keys en plaintext)
- **Configuración operativa** de AWS (NODE_ENV, IAM, CloudWatch, WAF, reserved concurrency)
- **Compliance con la ley local** (SIC, UIAF, Decreto 222, Estatuto 1480)
- **Defaults inseguros** (x-dev-user header se activa cuando NODE_ENV es undefined en Lambda)

Un auditor externo habría encontrado muchas de estas cosas. Pero la velocidad del pentest con IA — 5 días, 87 hallazgos, todos con CVSS vector, CWE, MITRE mapping, y código de remediación — es lo que hizo la diferencia entre "lo hacemos antes de lanzar" y "lo haríamos después si tuviéramos presupuesto y tiempo".

---

**Lo que NO hicimos** (para ser honesto):

- **No hicimos dynamic probing del Lambda en vivo** — el servicio aún no está deployado. El pentest fue 100% estático.
- **No auditamos Wompi ni Cognito** — son servicios externos.
- **No tenemos un auditor humano todavía** — la IA complementa, no reemplaza. Para producción real con dinero de usuarios, recomiendo los dos.

---

**Lo que viene ahora:**

1. **Phase 1: 22 production-blockers** — 5-7 días, ~40 horas de trabajo
2. **Compliance legal review en paralelo** — SIC, UIAF, Decreto 222
3. **Re-pentest** después de Phase 1 para verificar no-regresión
4. **Deploy a dev** (PR 8) — pentest dinámico del Lambda en vivo
5. **Auditor externo** antes de producción con dinero real
6. **GO/NO-GO revisado**

---

**Si trabajas en fintech** (o en cualquier sistema que maneje datos sensibles):

Te recomiendo correr un pentest antes de cada lanzamiento importante. La diferencia entre encontrar los bugs tú mismo en un sprint de 5 días, y encontrarlos en producción cuando un atacante te está robando dinero, es la diferencia entre **una historia que cuentas en LinkedIn** y **un comunicado de prensa que no quieres escribir**.

Y si quieres explorar cómo se ve un pentest automatizado con agentes de IA, échale un vistazo a **darkagents.opitacode.com** — la plataforma que estamos construyendo para hacer este tipo de auditoría accesible a equipos que no tienen $50K para un auditor externo en cada release.

El reporte completo (con código, CVSS vectors, y remediación propuesta) está disponible. Si quieres acceso, DM me.

---

#Pentest #SecurityAudit #Fintech #AI #DevSecOps #Colombia #CyberSecurity #AITools #PaymentGateway #OpenSource #Wompi #ClosedLoopWallet

---

## 📋 Notas para el operador

**Longitud final:** ~1,500 palabras. Dentro del rango óptimo para LinkedIn long-form (1,200-1,800).

**Por qué funciona:**

1. **Hook en las primeras 2 líneas** — "A 7 días de lanzar..." crea curiosidad inmediata. El "no Go" al final de la línea 5 obliga al lector a seguir.
2. **Historia real, no marketing** — los hallazgos son específicos (CVSS scores, nombres de archivos, líneas de código). Un auditor que lea esto puede verificar.
3. **Self-deprecating pero confiado** — admitimos lo que NO hicimos, lo que nos da credibilidad.
4. **Números concretos** — tablas, scores, tiempos. No "varios bugs" ni "muchos problemas".
5. **Promoción integrada, no forzada** — darkagents.opitacode.com aparece naturalmente como la herramienta que hizo posible el pentest. No es un banner, es contexto.
6. **CTA claro pero no agresivo** — "échale un vistazo" + DM para el reporte completo. No "regístrate ya".

**Cuándo publicar:**

- Martes, miércoles, o jueves
- 9-11am hora Colombia (hora pico para fintech/dev en LatAm)
- No publicar viernes (baja engagement)

**Engagement strategy (primeras 24h):**

- Responder TODOS los comentarios, idealmente en <2h
- Para preguntas técnicas (las habrá), citar el reporte completo + ofrecer DM
- Para preguntas sobre darkagents, redirigir a darkagents.opitacode.com
- Si algún comentario es de un auditor o pentester reconocido, responder con profundidad técnica — el algoritmo lo recompensa

**Hashtags (13, máximo recomendado 5-7):**

Recomiendo eliminar 6-8 para no saturar. Mis prioridades:
- #Pentest (core)
- #Fintech (audience)
- #AI (trend)
- #DevSecOps (audience)
- #Colombia (geo)
- #CyberSecurity (core)
- #Wompi (relevancia local)

**Cross-posting:**

- **NO** copies y pegues a Twitter — el formato no funciona. Usa el thread de 12 tweets que ya tienes en `social-media-pack.md`.
- **SÍ** puedes adaptar para un carrusel de Instagram (ya tienes el outline en `social-media-pack.md`).
- **SÍ** puedes usar el post de LinkedIn como base para un artículo de Medium o newsletter.

**Disclaimer importante:**

El post NO revela detalles de la implementación interna de los agentes (los dark-* sub-agents). Solo dice "agentes de IA especializados ejecutando metodología de pentest". Esto es intencional y correcto: el post es para una audiencia general, no para auditores técnicos que quieran saber cómo funciona darkagents.opitacode.com por dentro.

**Si quieres maximizar el impacto:**

1. Publica el martes 9am hora Colombia
2. Comparte el link al reporte completo en el primer comentario (no en el post, para que el algoritmo no lo penalice)
3. Taguea a personas relevantes en fintech/dev/AI en los comentarios (no en el post)
4. Prepara 5-6 respuestas técnicas para preguntas probables
5. Después de 24h, comparte un follow-up con métricas (engagement, comentarios destacados, lecciones aprendidas)

---

**¿Quieres que ajuste algo?** Tono más casual, más técnico, más corto, con énfasis diferente en algún punto, etc. Avísame.
