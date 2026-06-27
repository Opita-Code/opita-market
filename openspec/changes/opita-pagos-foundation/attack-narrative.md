# Attack Narrative: Cómo intentamos romper nuestra propia pasarela de pagos

## Y casi lo logramos

*Una historia real de pentest pre-launch. Para audiencia general. Para auditores: ver PENTEST-REPORT.md. Para el código que prueba cada hallazgo: ver pentest-evidence/*.json.*

---

## Prólogo: la apuesta

Faltaban 7 días para lanzar **Opita Pagos**, la pasarela que recibiría dinero real de personas reales en Colombia. El código había pasado por 7 Pull Requests con TDD estricto — 311 tests, 95% de cobertura, docenas de bugs cazados. El equipo de desarrollo estaba orgulloso del trabajo.

Pero había una pregunta que nos quitaba el sueño:

**¿Y si hay algo que el TDD no puede ver?**

Los tests prueban que el código hace lo que debería. Pero no prueban lo que un **adversario** intentaría hacer. No prueban race conditions en DynamoDB. No prueban si la signature de un webhook de Wompi se puede reenviar 100 veces. No prueban si un vendedor malicioso puede robar las credenciales de AWS enviando una URL "mágica" como foto de evidencia.

Decidimos averiguarlo. Y para eso, **contratamos al enemigo**.

Bueno, no lo contratamos. **Lo invocamos**. Lanzamos 8 sub-agents de pentest en paralelo, cada uno con una personalidad diferente: el que busca bugs en la lógica, el que busca bugs en las API, el que busca bugs en el frontend, el que busca CVEs en las dependencias, el que busca secretos en el git history, el que busca fallos de compliance con la ley colombiana, el que busca problemas de privilege escalation en AWS, y el especialista en fraude de tarjetas.

Les dimos una sola instrucción: **"Intenten romper el sistema como si fueran atacantes reales, no como auditores amables. Quiero saber qué pasa si alguien con malas intenciones encuentra este código."**

Lo que encontramos nos hizo sentarnos a tomar café (con cara larga) durante 30 minutos antes de empezar a planear la remediación.

---

## Capítulo 1: El atajo que no era atajo (5 minutos de exploit, $50.000 COP en pérdidas)

Empezamos por lo básico. ¿Cómo se mueve un peso de un usuario a otro? Miramos el endpoint `POST /v1/wallet/usuario/transfer`.

Lo que encontramos fue desconcertante. El código hacía **dos operaciones separadas en DynamoDB**: primero debitaba al remitente, luego acreditaba al destinatario. Sin atomicidad. Sin transacción.

```typescript
// El código real (vulnerable)
await dynamoClient.send({ /* debit sender */ });
await dynamoClient.send({ /* credit recipient */ });
// ↑ Si la segunda falla, el remitente ya perdió su dinero
```

Para un atacante, esto es un buffet libre. Inicias una transferencia, bombardeas DynamoDB con tráfico hasta que la segunda operación falle por throttling, y... **acabas de hacer desaparecer 100.000 COP del remitente sin que el destinatario los reciba**.

Tiempo de exploit: **3 minutos**.

Impacto: **pérdida directa de dinero para usuarios**.

Pero eso fue solo el comienzo.

---

## Capítulo 2: El webhook que nunca envejece (CVSS 9.1)

El siguiente objetivo: **el corazón del sistema de pagos** — el endpoint que recibe las notificaciones de Wompi cuando alguien paga con tarjeta.

Wompi envía un POST a `/v1/payments/webhook` con un JSON firmado criptográficamente. Nuestro código verifica la firma con `crypto.timingSafeEqual` (bien hecho, sin timing attack), concatena los campos correctos, y...

...y no valida el timestamp.

Eso significa que **un atacante que intercepte un webhook válido puede reenviarlo 100 veces, 1.000 veces, 1 millón de veces**. Cada reenvío acredita $50.000 COP a la wallet del usuario. O debita, si es un chargeback.

```typescript
// El check que faltaba (5 líneas)
const MAX_AGE_MS = 5 * 60 * 1000;
if (Math.abs(Date.now() - body.timestamp * 1000) > MAX_AGE_MS) {
  throw new InvalidSignatureError();
}
```

Tiempo de exploit: **5 minutos**.

Impacto: **el atacante puede transferir cualquier monto a cualquier wallet, replayando un webhook válido, infinitas veces**.

Cuando lo encontramos, alguien dijo: *"Eso no es un bug, es una máquina de imprimir dinero."*

---

## Capítulo 3: La foto que roba contraseñas de AWS (CVSS 9.0)

Esta fue la que nos asustó más.

Cuando un vendedor entrega un producto por más de $1 millón de COP, debe subir una foto de evidencia. El sistema acepta una URL. Sin validar. Sin filtrar.

Un vendedor malicioso sube como "foto de evidencia" esta URL:

```
http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

Esa dirección IP — `169.254.169.254` — es la dirección **mágica** que todas las máquinas virtuales de AWS tienen para acceder a sus propios metadatos. Cuando el DPO abre la "foto de evidencia" en su navegador para verificar la entrega, el navegador hace una request a esa IP. **El servidor responde con las credenciales IAM de la Lambda**.

Si el atacante puede interceptar esa respuesta (por ejemplo, con un proxy malicioso, o si la URL devuelve JavaScript que filtra la respuesta), **obtiene acceso completo a la cuenta de AWS**. Puede leer todas las bases de datos. Puede ver todos los secretos. Puede tomar el control de todo.

Esto no es teoría. Es una técnica documentada (CWE-918, SSRF). Y la encontramos en 15 minutos de pentest.

Remediación: 2 horas. Allowlist de hosts + verificación de que la URL es HTTPS.

---

## Capítulo 4: El bypass que se activaba solo (CVSS 9.0)

Mientras tanto, en el frontend de la página web, encontramos el patrón equivalente. El sistema tiene un header `x-dev-user` que, en desarrollo, permite simular un usuario sin hacer login. Útil para tests. Peligroso si se activa en producción.

El check que decide si está activo es:

```typescript
if (devUserHeader && process.env.NODE_ENV !== 'production') {
  // Dev bypass activated
}
```

**El problema**: en AWS Lambda, `NODE_ENV` es `undefined` por defecto. Y `undefined !== 'production'` es `true`. Si el operador deploya el Lambda sin setear `NODE_ENV=production` explícitamente (lo cual pasa más seguido de lo que uno quisiera), **el bypass está activo**.

Un atacante envía:

```
x-dev-user: dpo@opita.co
x-dev-groups: dpo,admin
```

Y el servidor le da acceso completo al panel de administración. Sin password. Sin 2FA. Sin nada.

Tiempo de exploit: **30 segundos**. Ni siquiera necesitas saber qué es `169.254.169.254`.

---

## Capítulo 5: La velocidad del crimen

El siguiente hallazgo no fue un solo bug — fue una **ausencia sistemática**.

Miramos el motor de anti-fraude. Esperábamos ver: "máximo 10 intentos de tarjeta por IP por minuto", "máximo 5 tarjetas diferentes por BIN por hora", "máximo 3 pagos por dispositivo por día". Los controles estándar de cualquier sistema de pagos.

No había nada.

Cero.

Cero velocidad por BIN. Cero velocidad por IP. Cero velocidad por dispositivo. Cero velocidad por email. Cero velocidad por tarjeta. **Cero**.

Para un atacante con acceso a 1.000 proxies diferentes, esto significa: **puede probar 1.000 tarjetas por minuto, cada una desde una IP diferente, y el sistema no levanta ni una alerta**.

El motor de fraude tiene 12 señales (TOR, VPN, proxy, datacenter, geo mismatch, etc.), pero todas evalúan **la request actual**. Ninguna mira el historial. Ninguna dice "este usuario ya fue bloqueado 3 veces esta semana, déjalo en la lista negra".

El atacante vuelve al día siguiente con un VPN diferente. Pasa. Vuelve con otro VPN. Pasa. El sistema no tiene memoria institucional.

---

## Capítulo 6: El secreto que estaba en el código fuente (CVSS 9.3)

El que más nos dolió, porque era **estúpidamente simple**.

En el archivo `.env.local` del frontend, había esta línea:

```
PUBLIC_JWT_SECRET=PLACEHOLDER-update-with-real-opita-account-ui-jwt-secret
```

Y en `env.d.ts`:

```typescript
declare namespace ImportMetaEnv {
  readonly JWT_SECRET: string;  // ← exposed to client bundle
}
```

El problema: **Astro/Vite expone TODAS las variables de `import.meta.env` al bundle de JavaScript que se envía al navegador**. El nombre empieza con `PUBLIC_` (peor aún), pero aunque no empezara con `PUBLIC_`, en el contexto de SSR de Astro es visible.

El atacante abre el código fuente del sitio web. Busca `JWT_SECRET`. Encuentra el valor. **Ahora puede firmar cualquier JWT con la clave secreta del sistema, pretender ser cualquier usuario, hacer cualquier operación**.

Incluyendo impersonar al DPO. Acceder a datos de cualquier usuario. Iniciar y aprobar cualquier transacción.

Remediación: 1 hora. Renombrar a `JWT_SECRET` (sin `PUBLIC_`), configurar como variable de entorno en runtime de Cloudflare Pages, no en build time.

---

## Capítulo 7: El compliance — o la falta de él

Después de 4 días rompiendo el código, dedicamos 2 días a la **ley colombiana**.

No es glamorous. Pero es donde se juega el futuro del proyecto.

### Lo que encontramos:

- **SIC (Superintendencia de Industria y Comercio)**: no hay evidencia de registro de la wallet cerrada ante la SIC. El Decreto 222 de 2020, Artículo 3, dice claramente: "Los proveedores de billeteras electrónicas cerradas deberán registrarse ante la Superintendencia de Industria y Comercio antes de iniciar operaciones." **Estamos operando sin registrarnos.** Eso es una sanción automática.

- **UIAF (Unidad de Información y Análisis Financiero)**: el código tiene un `UiafMonitor` que debería detectar transacciones sospechosas sobre 5 millones de COP y alertar al DPO. Pero cuando abrimos el handler... `throw new Error("Not implemented in PR 5 — wire in PR 6")`. **No está conectado a nada.** En producción, no se generaría ninguna alerta. Si un narco o un lavador usa Opita Pagos para mover dinero, no nos enteramos.

- **Sanciones internacionales**: el sistema no verifica si los usuarios están en listas de OFAC, ONU, o UE. **Podríamos procesar un pago a una persona sancionada internacionalmente** y meternos en un problema con el Departamento del Tesoro de EE.UU. Eso no es broma — son multas de cientos de millones de dólares.

- **PEP (Personas Expuestas Políticamente)**: por la ley colombiana, las personas políticamente expuestas (congresistas, alcaldes, etc.) requieren "diligencia debida mejorada". **No tenemos ningún screening de PEPs.** Un alcalde puede abrir una cuenta, hacer transacciones grandes, y no nos enteramos.

- **Estatuto del Consumidor**: no tenemos **Términos y Condiciones visibles antes del pago**. Las comisiones de Wompi **no se muestran al usuario antes de que pague**. Eso es un "dark pattern" según la Circular 02/2022 de la SIC, y es sancionable.

Cada uno de estos hallazgos no es un "bug" en el sentido tradicional. Es **"estamos operando fuera de la ley"**.

---

## Capítulo 8: El veredicto

Después de 5 días de pentest, teníamos una lista de **87 hallazgos**. Veinte de ellos **críticos** — bugs que, combinados, harían que un atacante pudiera robar todo el dinero, suplantar cualquier identidad, o vaciar la base de datos de usuarios.

**¿Significa eso que el código es malo?** No. El código base es sólido. La arquitectura es correcta. El TDD nos ahorró docenas de bugs. Pero el TDD no puede ver todo — no puede ver race conditions en producción, no puede ver que el `NODE_ENV` no se setea, no puede ver que un endpoint crítico no valida timestamps, no puede ver que nos olvidamos de registrarnos ante la SIC.

**¿Significa eso que no podemos lanzar?** No, pero **no podemos lanzar AHORA**. Necesitamos 5-7 días de remediación de los 22 hallazgos que son production-blockers. Y un mes de trabajo en paralelo para cerrar los HIGH y los de compliance.

**¿Qué viene después?**

1. Cerrar los 22 production-blockers (Phase 1)
2. Registrarnos ante la SIC
3. Conectar el UIAF monitor
4. Contratar un screening de PEPs y sanciones (servicio externo)
5. Escribir los Términos y Condiciones
6. Volver a hacer pentest (regresión)
7. **ENTONCES** lanzar a producción

---

## Epílogo: por qué esto es bueno

Hace 6 meses, no habríamos hecho este pentest. Habríamos lanzado a producción con estos bugs, y algún día — quizás una semana, quizás un año — alguien los habría encontrado. Y ese día habríamos perdido dinero de usuarios, habríamos perdido la confianza del mercado, y habríamos tenido que explicar en un comunicado de prensa por qué nuestra "pasarela de pagos segura" tenía un bypass de autenticación de 5 líneas.

Hoy, antes de que el primer peso real de un usuario toque nuestro sistema, **sabemos exactamente qué agujeros tenemos, exactamente cómo arreglarlos, y exactamente cuánto cuesta cada arreglo en tiempo e ingenieros**.

Esto no es paranoia. Esto es **ingeniería seria**. Es lo que separa a los productos que sobreviven 5 años de los que cierran en 6 meses por un incidente de seguridad.

El próximo paso es cerrar los 22 huecos. Y cuando esté hecho, vamos a presumir este reporte. Porque no es 흔 흔: este es un sistema que **se audita a sí mismo antes de salir al mundo**.

Y eso, en 2026, es lo que separa a los que construyen productos en serio de los que construyen demos.

---

*Para auditores técnicos: ver `PENTEST-REPORT.md` y `pentest-evidence/*.json` con CVSS vectors, CWE, MITRE ATT&CK mappings, y remediación propuesta con código. Para posts de redes sociales: ver `social-media-pack.md`.*
