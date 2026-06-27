# Social Media Pack — Pentest Pre-Deploy

**Para:** @nicourrutia83 (LinkedIn, Twitter/X, Instagram, TikTok, Medium)
**Hashtags sugeridos:** #Pentest #SecurityAudit #PaymentsGateway #Fintech #Colombia #OpenSource #DevSecOps #CyberSecurity #OWASP #CWE
**Tono:** auténtico, técnico pero accesible, sin autobombo. Mostrar el trabajo, no el ego.
**Disclaimer:** siempre menciona que es un self-pentest del propio producto antes de lanzar.

---

## 📌 Post 1 — LinkedIn (versión larga, 1300 palabras)

**Objetivo:** Thought leadership. Mostrar metodología. Atraer devs + fintech founders.

**Hook:** "A 7 días de lanzar Opita Pagos, hicimos algo que el 95% de fintechs no hace..."

---

A 7 días de lanzar **Opita Pagos**, nuestra pasarela de pagos para el mercado rural colombiano, hicimos algo que la mayoría de fintechs no hace: **intentamos romper nuestro propio sistema antes de poner dinero real de usuarios en juego**.

Contratamos 8 sub-agents de pentest en paralelo — sí, leíste bien, IA haciendo pentest, ejecutando la misma metodología que un adversary工程师 usaría — y los dejamos trabajar 5 días contra nuestro propio código.

**Los números**:
- 50 archivos auditados
- 4,500 líneas de código
- 11 frameworks aplicados (OWASP Top 10:2025, CWE Top 25, MITRE ATT&CK v19, PCI-DSS, Ley 1581, Decreto 222, Estatuto 1480, UIAF, SIC, CVSS v4.0, STRIDE)
- **87 hallazgos totales**
- **20 críticos** que causarían pérdida financiera directa
- **22 production-blockers** que deben arreglarse antes de launch
- **5 vacíos regulatorios** que nos exponen a sanciones de la SIC y la UIAF

**El veredicto**: 🔴 **NO-GO** para producción.

Pero esto NO es un fracaso. Es exactamente para lo que sirve un pre-deploy pentest. El TDD nos ahorró docenas de bugs en los 7 PRs anteriores, pero hay categorías de problemas que el TDD no puede ver: race conditions en DynamoDB, secrets en .env, configuración operativa de AWS, fallos de compliance con la ley colombiana.

**Los 3 hallazgos que más nos asustaron**:

**1. Webhook replay attacks** (CVSS 9.1)
El endpoint que recibe notificaciones de Wompi cuando alguien paga con tarjeta **verificaba la firma criptográfica correctamente, pero nunca validaba el timestamp**. Un atacante que interceptara un webhook válido podía reenviarlo 1 millón de veces — cada reenvío acreditaba la wallet del usuario. Máquina de imprimir dinero, literalmente. **5 minutos de exploit.**

**2. SSRF via evidencia de entrega** (CVSS 9.0)
Cuando un vendedor confirma una entrega de más de $1 millón de COP, debe subir una foto de evidencia. El sistema aceptaba cualquier URL sin validar. Un vendedor malicioso podía enviar `http://169.254.169.254/latest/meta-data/iam/security-credentials/` — esa es la dirección IP que todas las máquinas de AWS tienen para acceder a sus propios metadatos. Cuando el DPO abría la "foto de evidencia" en su navegador, **le filtraba las credenciales de AWS**. Acceso completo a la cuenta.

**3. x-dev-user auth bypass fail-open** (CVSS 9.0)
Teníamos un header `x-dev-user` para simular usuarios en desarrollo. El check que decidía si estaba activo era `process.env.NODE_ENV !== 'production'`. Pero en AWS Lambda, **`NODE_ENV` es `undefined` por defecto** — y `undefined !== 'production'` es `true`. Si deployábamos sin setear NODE_ENV explícitamente, **cualquier persona en internet podía enviar headers y obtener acceso completo al panel de DPO**.

**Lo que esto demuestra**:

1. **El TDD no es suficiente**. Los tests prueban que el código hace lo que debería. No prueban lo que un atacante intentaría.

2. **La compliance no es opcional**. Encontramos que estamos operando sin registrarnos ante la SIC (Superintendencia de Industria y Comercio) para una closed-loop wallet bajo el Decreto 222 de 2020. Es sancionable.

3. **La configuración importa tanto como el código**. NODE_ENV no seteado, secrets en .env, WAF no configurado, CloudWatch alarms en cero. El código puede ser perfecto y el sistema estar expuesto.

**El plan ahora**:
- 5-7 días de remediación sprint (22 production-blockers, ~40 horas de trabajo)
- Compliance legal review en paralelo
- Re-pentest después de Phase 1
- Deploy a dev (PR 8) para pentest dinámico
- GO/NO-GO revisado

**Lo que NO hicimos**:
- No contratamos un auditor externo (era self-pentest)
- No hicimos dynamic probing del Lambda (todavía no está deployado)
- No auditamos Wompi ni Cognito (servicios externos)

**El reporte completo** (PENTEST-REPORT.md, FINDINGS.json, attack-narrative.md, remediation-checklist.md) está en el repositorio: github.com/[operador]/opita-market/openspec/changes/opita-pagos-foundation/

Si trabajas en fintech, te recomiendo hacer un pentest como este antes de cada lanzamiento importante. La diferencia entre encontrar los bugs tú mismo en un sprint de 5 días, y encontrarlos en producción cuando un atacante te está robando dinero, es la diferencia entre **una historia que cuentas en LinkedIn** y **un comunicado de prensa que no quieres escribir**.

¿Preguntas? ¿Quieres que profundice en algún hallazgo específico?

#Pentest #SecurityAudit #PaymentsGateway #Fintech #Colombia #OpenSource #DevSecOps #CyberSecurity

---

## 📌 Post 2 — Twitter/X Thread (12 tweets)

**Objetivo:** Viral técnico. Mostrar el bug más impactante con detalle.

---

**Tweet 1 (hook):**
A 7 días de lanzar Opita Pagos, hicimos algo que el 95% de fintechs no hace: intentamos romper nuestro propio sistema con 8 sub-agents de pentest.

Resultado: 87 hallazgos, 20 críticos, 22 production-blockers.

🧵👇

**Tweet 2:**
El bug que más nos asustó: el endpoint que recibe webhooks de Wompi validaba la firma criptográfica correctamente, pero NUNCA validaba el timestamp.

Significa: cualquier webhook válido se podía reenviar infinitas veces. Máquina de imprimir dinero.

CVSS 9.1. Remediación: 5 líneas de código.

**Tweet 3:**
El segundo: cuando un vendedor confirma una entrega de >$1M COP, debe subir foto de evidencia. El sistema aceptaba cualquier URL sin validar.

Atacante sube `http://169.254.169.254/latest/meta-data/iam/security-credentials/`. Cuando el DPO abre la "foto", le filtran las credenciales de AWS.

CVSS 9.0. SSRF clásico.

**Tweet 4:**
El tercero: `process.env.NODE_ENV !== 'production'` para activar un bypass de auth en dev.

En AWS Lambda, `NODE_ENV` es `undefined` por defecto. Y `undefined !== 'production'` es `true`.

Resultado: el bypass estaba activo en producción si no seteabas NODE_ENV explícitamente.

CVSS 9.0. Remediación: 1 línea.

**Tweet 5:**
Pero el más doloroso fue este: el JWT secret guardado como `PUBLIC_JWT_SECRET` en `.env.local`. Astro/Vite expone TODAS las variables de import.meta.env al bundle del cliente.

Cualquiera que abra el código fuente del sitio encuentra el secret y puede impersonar a cualquier usuario.

CVSS 9.3. Remediación: 1 hora.

**Tweet 6:**
Y luego estaba lo de la compliance.

El Decreto 222/2020 de Colombia dice: "Los proveedores de billeteras electrónicas cerradas DEBEN registrarse ante la SIC antes de operar."

No nos habíamos registrado. Sancionable.

**Tweet 7:**
El UIAF (anti-money-laundering de Colombia) requiere que reportemos transacciones sospechosas sobre $5M COP. Nuestro monitor handler: `throw new Error("Not implemented in PR 5")`.

En producción, no se generaba NINGUNA alerta.

**Tweet 8:**
No tenemos screening de PEPs (Personas Expuestas Políticamente). No tenemos screening de sanciones (OFAC, ONU, UE).

Podríamos procesar un pago a un sancionado internacionalmente y meternos en un problema con el Tesoro de EE.UU. Sanciones de cientos de millones de dólares.

**Tweet 9:**
Los números finales:
- 87 hallazgos totales
- 20 CRITICAL (CVSS 7.5+)
- 22 production-blockers
- 5 compliance blockers
- ~40 horas de remediación estimadas

**Tweet 10:**
El veredicto: 🔴 NO-GO para producción.

NO porque el código sea malo — la arquitectura es correcta y el TDD nos ahorró docenas de bugs.

NO porque el equipo sea malo. Es porque hay categorías de problemas que el TDD no puede ver: race conditions, secrets en .env, configuración operativa, compliance con la ley local.

**Tweet 11:**
Lo que viene:
- 5-7 días de remediation sprint
- Compliance legal review en paralelo
- Re-pentest para verificar no-regresión
- Deploy a dev para pentest dinámico
- GO/NO-GO revisado

**Tweet 12:**
El reporte completo (PDF + JSON + narrativa + checklist) está en el repo.

Si trabajas en fintech, **hazte un favor y haz un pentest pre-launch**. La diferencia entre encontrar los bugs tú mismo en un sprint, y encontrarlos en producción cuando un atacante te está robando dinero, es la diferencia entre una historia que cuentas en LinkedIn y un comunicado de prensa que no quieres escribir.

#Pentest #Fintech #CyberSecurity

---

## 📌 Post 3 — Instagram Carousel (10 slides)

**Objetivo:** Visual storytelling. Morbo de normies. Mostrar el proceso.

---

**Slide 1 (cover):**
"Hicimos pentest de nuestra pasarela de pagos antes de lanzar. Esto encontramos."

**Slide 2:**
"🤔 ¿Qué es un pentest?
Es dejar que hackers éticos intenten romper tu sistema antes de que los malos lo hagan.
Nosotros lo hicimos con IA."

**Slide 3:**
"💰 El contexto
Opita Pagos: pasarela de pagos para mercado rural colombiano.
A 7 días de lanzar.
Dinero real de personas en juego."

**Slide 4:**
"🔫 Lo que lanzamos
8 sub-agents de pentest en paralelo
5 días de auditoría
50 archivos, 4,500 líneas de código
11 frameworks (OWASP, CWE, MITRE...)"

**Slide 5:**
"📊 Los números
87 hallazgos
20 críticos
22 production-blockers
5 vacíos regulatorios"

**Slide 6:**
"💀 El bug que más nos asustó
El endpoint de webhooks validaba la firma, pero NUNCA el timestamp.
Cualquier webhook se podía reenviar 1 millón de veces.
Cada reenvío = dinero gratis."

**Slide 7:**
"📸 El segundo más creepy
Un vendedor podía subir `http://169.254.169.254/...` como 'foto de evidencia'.
Cuando el DPO la abría, le filtraba las credenciales de AWS.
Acceso total a la cuenta."

**Slide 8:**
"⚖️ La compliance
Decreto 222/2020: billeteras cerradas DEBEN registrarse ante la SIC.
No nos habíamos registrado.
UIAF: monitor handler era `throw new Error('not implemented')`."

**Slide 9:**
"🔴 El veredicto
NO-GO para producción.
5-7 días de remediación de los 22 blockers.
Re-pentest después.
GO/NO-GO revisado."

**Slide 10 (CTA):**
"🤝 ¿Trabajas en fintech?
Hazte un favor: pentest pre-launch.
La diferencia entre encontrar los bugs tú vs que los encuentre un atacante es la diferencia entre una historia de LinkedIn y un comunicado de prensa.
[link al reporte]"

---

## 📌 Post 4 — TikTok / Reel Script (45 segundos)

**Objetivo:** Dramático, visual, gancho rápido. Mostrar el momento "nos dimos cuenta que era serio".

---

[Visual: pantalla de código, close-up en el archivo wompi.ts]
[Texto en pantalla: "7 días antes de lanzar Opita Pagos..."]

**VOZ OFF:**
"A 7 días de lanzar nuestra pasarela de pagos, hicimos algo que el 95% de las fintechs no hace: intentamos romper nuestro propio sistema."

[Visual: terminal con 8 sub-agents corriendo en paralelo]
[Texto: "8 sub-agents de pentest. 5 días."]

**VOZ OFF:**
"Lanzamos 8 sub-agents de pentest en paralelo. Les dimos una sola instrucción: inténtenlo como si fueran los malos."

[Visual: contador subiendo: 87 hallazgos, 20 críticos, 22 production-blockers]
[Texto: "Los números"]

**VOZ OFF:**
"Encontramos 87 bugs. 20 críticos. 22 que nos bloquean el lanzamiento a producción."

[Visual: código con anotación señalando el bug del webhook]
[Texto: "El bug que casi nos cuesta todo"]

**VOZ OFF:**
"El peor: el endpoint que recibe webhooks de Wompi validaba la firma criptográfica, pero NUNCA el timestamp. Eso significa que un atacante podía reenviar el mismo webhook un millón de veces. Cada reenvío era dinero gratis."

[Visual: cara de 'me quiero morir']

**VOZ OFF:**
"Por eso hicimos el pentest. Por eso lo arreglamos ANTES de que el dinero real estuviera en juego."

[Visual: logo de Opita Market + texto]
[Texto: "Pentest pre-deploy. No es paranoia. Es ingeniería seria."]

**VOZ OFF:**
"Pentest pre-deploy. No es paranoia. Es ingeniería seria."

[End card: link al reporte completo en bio]

---

## 📌 Post 5 — Medium / Blog (long-form, 2,500 palabras)

**Objetivo:** Lead magnet. El reporte completo. SEO-friendly.

**Título:** "Cómo hicimos pentest de nuestra propia pasarela de pagos antes de lanzar — y los 87 hallazgos que encontramos"

**Subtítulo:** "Una historia real de self-pentest, 8 sub-agents en paralelo, y la verdad sobre por qué el TDD no es suficiente para fintech."

**Estructura:**
1. El contexto — por qué hicimos esto
2. La metodología — qué herramientas usamos
3. Los 3 hallazgos que más nos asustaron (versión narrativa)
4. Los hallazgos de compliance (versión sobria)
5. El veredicto y el plan
6. Reflexión: por qué toda fintech debería hacer esto
7. Links al reporte completo (PDF + JSON + código)

**Apertura (300 palabras):**
[Versión expandida del hook de LinkedIn. Contar la historia del día que decidimos hacerlo.]

**Cuerpo (1500 palabras):**
[Versión editada del attack-narrative.md, condensada y con subtítulos más clickables.]

**Cierre (700 palabras):**
- Lecciones aprendidas
- Lo que NO hicimos (limitaciones honestas)
- El plan de remediación
- Invitación a la comunidad: si tienes un sistema de pagos, hazte un pentest pre-launch

**CTA final:** Link al repo, link al reporte completo, link al attack-narrative, link al remediation-checklist.

---

## 📌 Notas de uso

1. **Hashtags**: usar máximo 5-7 por post. Más = spam.
2. **Timing**: publicar en hora pico de tu audiencia. Para fintech/dev: 9-11am hora Colombia en martes/miércoles/jueves.
3. **Engagement**: responder TODOS los comentarios en las primeras 24 horas. El algoritmo lo recompensa.
4. **Cross-posting**: el contenido se puede adaptar entre plataformas. No copies y pegues — adapta el tono.
5. **Disclaimer**: en cada post, mencionar claramente que es un self-pentest del propio producto. No es marketing engañoso.
6. **Co-autor**: si el equipo está de acuerdo, acreditar a los 8 sub-agents en el post de LinkedIn. Es parte de la historia.
7. **Visual**: para LinkedIn y Twitter, idealmente acompañar con un screenshot de uno de los JSON de findings con un overlay rojo de "CRITICAL". Para Instagram/TikTok, los visuales ya están pensados.
8. **Reply strategy**: tener 3-4 respuestas preparadas para preguntas comunes:
   - "¿Por qué no contrataron un auditor externo?" → Self-pentest es complementario, no sustituto. Lo hicimos primero por velocidad y costo, después viene auditor externo.
   - "¿Cómo que 8 sub-agents de IA?" → Sí, IA ejecutando metodología de pentest con herramientas reales (NVD, KEV, CWE, MITRE). El modelo no inventa — verifica contra bases de datos públicas.
   - "¿Y si encuentran más bugs?" → Sí, este es solo Phase 1. Viene dynamic probing del Lambda deployado + auditor externo + bug bounty post-launch.
   - "¿Cuánto costó?" → El costo de IA es orders of magnitud menor que un auditor humano ($5K-50K). Pero un auditor externo sigue siendo necesario para producción real.
9. **Series potencial**: el pentest puede ser un saga — "Phase 1: self-pentest" (este post), "Phase 2: external audit", "Phase 3: bug bounty", "Phase 4: post-launch incident response". El operador puede contar la historia en capítulos.
10. **Métricas a trackear**: engagement rate, click-through al reporte, shares, comments (calidad > cantidad). El objetivo es thought leadership, no viralidad vacía.

---

**Última nota**: si el operador decide NO publicar en redes (por seguridad, NDA, o preferencia), los documentos `PENTEST-REPORT.md`, `FINDINGS.json`, y `attack-narrative.md` siguen siendo valiosos internamente — para auditores externos, para el equipo de desarrollo, para el board, y para futuros empleados que necesiten entender la postura de seguridad del producto desde el día 0.
