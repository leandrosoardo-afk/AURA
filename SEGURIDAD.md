# AURA · Seguridad antes de lanzar

Revisión de la lista "20 cosas para pedirle a Claude antes de lanzar tu app" (16/11/2026).
Cada punto dice cómo lo cumple AURA y dónde está en el código. Las pruebas automáticas están en `tests/` (314 en total).

| # | Requisito | Estado | Cómo lo cumple AURA |
|---|---|---|---|
| 1 | Ocultar API keys | ✅ | La clave de Gemini y la del correo viven solo en `.env`, en el servidor. Nunca llegan al navegador (verificado: no aparecen en `dist/`). La clave de Gemini viaja en un encabezado, no en la URL, y no se escribe en los registros. |
| 2 | Eliminar secretos de Git | ✅ | El proyecto no está en Git todavía. `.gitignore` y `.dockerignore` excluyen `.env`; la imagen de Docker no lo incluye (recibe las variables al arrancar). `.env.ejemplo` solo tiene nombres, sin valores. |
| 3 | Key pública para DB | ✅ (no aplica) | No hay base expuesta a internet ni clave pública: PostgreSQL escucha solo en esta Mac (`localhost`) y la app entra con un rol limitado (`cajaclara_v4_app`), sin permisos de superusuario ni de saltear RLS. |
| 4 | Row-Level Security | ✅ | RLS en perfiles, suscripciones, espacios, movimientos, compromisos, parámetros de caja y movimientos eliminados. Cada consulta declara el usuario (`conUsuario`) y la base solo deja ver sus filas. |
| 5 | Encriptar datos sensibles | ✅ | Contraseñas con bcrypt; tokens de sesión y de recupero guardados como hash SHA-256. El disco de la Mac tiene FileVault activado. La conexión al enlace público es HTTPS. |
| 6 | Forzar la autenticación | ✅ | Toda la API exige sesión salvo ingresar, registrarse, recuperar la contraseña y la lista de planes. |
| 7 | Restringir el acceso a registros | ✅ | Además de RLS, cada ruta verifica que el espacio sea del usuario (`espacioPropio`): uno ajeno responde 404, sin revelar que existe. |
| 8 | Bloquear manipulación de campos | ✅ | Cada pedido se valida con un esquema (zod) que solo acepta los campos previstos; el usuario sale siempre de la sesión. En la base, la app solo puede modificar columnas puntuales (permisos por columna). |
| 9 | Proteger session cookies | ✅ | Cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción, 30 días, token aleatorio de 256 bits. Además se rechazan escrituras de otros sitios (control de origen). Cambiar o recuperar la contraseña cierra las demás sesiones. |
| 10 | Hashear contraseñas | ✅ | bcrypt con costo 12. Se compara siempre contra un hash (aunque la cuenta no exista) para no delatar qué mails están registrados. |
| 11 | Rate limiting | ✅ **(ampliado)** | Ingreso, registro y recupero: 20 intentos cada 15 min por IP y **nuevo**: 10 por cuenta. Chat: 30 preguntas cada 10 min. **Nuevo**: tope general de 600 pedidos cada 5 min por IP para toda la API. |
| 12 | Protección contra bots | ✅ **(nuevo)** | Registro y recupero tienen un campo trampa invisible y miden cuánto se tardó en enviar el formulario: si parece un bot, se rechaza (en el recupero se le responde igual, sin mandar mail). Sumado a los límites del punto 11. |
| 13 | Parametrizar queries | ✅ | Todas las consultas usan parámetros (`$1`, `$2`…). Lo único que se arma con texto son constantes del código (límites, zona horaria). |
| 14 | Validar inputs | ✅ | Montos, fechas, textos, ids (UUID), archivos y respuestas del cuestionario se validan en el servidor, con mensajes claros. |
| 15 | Sanitizar contenido | ✅ | React escapa todo lo que se muestra; no se inserta HTML con datos del usuario. El mail escapa el enlace. Las respuestas de Gemini se tratan como texto no confiable (se controlan rutas y cifras). El Excel exporta los textos como texto, no como fórmulas. |
| 16 | Restringir archivos | ✅ | Foto de perfil: solo JPG, PNG o WebP, máximo 400 KB, guardada y servida con su tipo y `nosniff`. Excel: se lee en el navegador y al servidor llegan filas validadas (hasta 5000, máximo 2 MB). El servidor solo entrega la carpeta `dist`. |
| 17 | Devolver datos necesarios | ✅ | Las respuestas no incluyen hashes, tokens ni datos de otros usuarios; los errores del servidor son genéricos (sin detalles internos) y no se envía `X-Powered-By`. Verificado en `tests/seguridad.test.ts`. |
| 18 | Security headers | ✅ **(ampliado)** | helmet: CSP, HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, COOP/CORP. **Nuevo**: `Permissions-Policy` (cámara para la foto y micrófono para dictarle al asistente, solo en el propio sitio; ubicación y pagos desactivados). |
| 19 | Forzar HTTPS | ✅ **(nuevo)** | El enlace público solo funciona por HTTPS: si se entra por `http://`, el servidor redirige a `https://` (301), y HSTS hace que el navegador no vuelva a usar http. |
| 20 | Escanear dependencias | ✅ **(corregido)** | `npm audit` encontraba fallas en herramientas de desarrollo (Vite 5, Vitest 1, esbuild). Se actualizaron a Vite 8.3.5, Vitest 5.0.5 y @vitejs/plugin-react 6.1.2 (versiones con más de dos semanas publicadas). Resultado: **0 vulnerabilidades**. Para repetirlo: `npm run seguridad`. |

## Pendiente o a tener en cuenta

- **CAPTCHA**: si la app se abre al público, conviene sumar Cloudflare Turnstile (gratis, necesita una cuenta de Cloudflare).
- **Copias de seguridad** de la base: hoy no hay; para producción conviene un `pg_dump` periódico.
- **Enlace fijo y propio**: el enlace temporal de Cloudflare cambia; para producción, dominio propio con túnel con cuenta.
