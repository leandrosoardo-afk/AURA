# Aura (ex Caja Clara) V4 · Especificación

## Alcance de esta etapa

| Pedido | Cómo está resuelto |
|---|---|
| PostgreSQL | Bases `cajaclara_v4` y `cajaclara_v4_test`, migraciones en `server/migraciones/` |
| Registro de usuario PyME o persona | Alta en `/registro`. El tipo se elige en el primer paso |
| Cuestionario inicial en el alta | 7 preguntas por tipo de usuario, en `shared/cuestionario.ts` |
| La interfaz se adapta al perfil | `shared/adaptacion.ts` define pregunta principal, orden de módulos, categorías, consejos y explicaciones |
| Tres suscripciones | Tabla `planes`: Gratis ($0, con publicidad y 30 registros por mes), Intermedio ($9.900) y Full ($25.900) |
| Elegir plan con precio y sin pago | Último paso del alta. No hay botón de pago ni se piden datos de pago. El estado queda `sin_cobro` |
| Perfil y espacio inicial por usuario | Se crean en la misma transacción que el usuario. Un trigger de la base rechaza un usuario sin ellos |
| Aislamiento de espacios de trabajo | Dos capas independientes (ver abajo) |
| Caja a 30 días | Proyección diaria con semáforo, peor día y cuota segura. Motor en `shared/motor.ts`, calculado en el servidor |
| Vencimientos | Agenda de pagos y cobros. Marcar pagado crea el movimiento y, si es mensual, agenda el próximo |
| Ingresos y egresos del mes en el Inicio | Gráfico `GraficoMes.tsx` con lo que entró y salió, acumulado día por día hasta hoy; los egresos van en rojo. Datos en `resumen.diasMes` |
| Borrar sin perder registro | Borrar un movimiento lo guarda en `movimientos_eliminados` (trigger) y se puede restaurar desde Movimientos → Eliminados. Si era el pago de algo agendado, ese pago vuelve a pendiente y se saca el próximo mensual que se había agendado solo (`generado_por`). Eliminar de la agenda lo deja "anulado" en el historial de Pagos y cobros futuros, con "Volver a agendar"; los pagados tienen "Deshacer pago". Migración 007 |
| Dictado por voz | Botón de micrófono en el asistente (`src/dictado.ts`, Web Speech API del navegador, español de Argentina): escribe mientras la persona habla y envía solo al terminar. Funciona en Chrome, Edge y Safari; en Firefox avisa que no está disponible. AURA no recibe el audio, solo el texto |
| Correo de recupero | Gmail con contraseña de aplicación (`SMTP_*` en .env). Mail con botón; el enlace usa la dirección por la que se pidió si es conocida (localhost o *.trycloudflare.com), si no `APP_URL`. `npm run correo:probar -- mail` verifica la configuración. Logo animado también en ingreso, registro y recupero |
| Acciones de arriba a la derecha | En todas las pantallas (computadora): + que cambia según la pantalla (en Pagos y cobros futuros agenda; en el resto registra ingreso o gasto), Simular préstamo (ícono de mano con monedas) y la foto de perfil más grande, con carteles al pasar el mouse. En el celular el + del centro hace lo mismo |
| Planes respetados | Lo que el plan no incluye se ve en gris con candado (menú, "Más", Tu espacio, simular); al tocarlo se explica qué plan lo incluye y se ofrece ir a Configuración. El servidor ya lo exige (`exigirModulo`). Las respuestas con IA son del plan Full (módulo asistente); los demás usan la guía |
| Logo animado | Arriba a la izquierda del menú, video en loop (`logo-aura-animado.webm`/`.mp4`, ~45 KB) hecho del GIF del grupo (13 MB); `logo-aura-completo.png` como imagen fija mientras carga |
| Asistente más inteligente | Dos tipos de respuesta: sobre la app (solo la guía, cada cifra controlada) y generales (educación financiera y otras dudas, 2 o 3 párrafos). No da valores del día ni dice qué hacer con la plata: explica criterios y manda a Mercado. Los pedidos de consejo también van a Gemini; si falla, la guía responde la negativa. Modelo `gemini-3.5-flash-lite`, respaldo `gemini-3.1-flash-lite` si está saturado |
| Asistente flotante | Burbuja con la animación del grupo (`public/asistente-aura.gif`) en la esquina inferior derecha; al tocarla abre la ventanita del chat (Gemini si hay `GEMINI_API_KEY`, guía local si no). El + queda arriba |
| Informes (plan Full) | `/informes`: período (este mes, mes pasado, 3 meses, año o fechas elegidas) y qué incluir: movimientos con totales por categoría, tu plata/caja a 30 días y pagos y cobros futuros. PDF con la impresión del navegador (estilos de impresión propios) y Excel de varias hojas (`write-excel-file`). Servidor: `GET /api/espacios/:id/informe` con `exigirModulo('informes')` |
| Cambio de plan | En Configuración, "Tu suscripción": subir o bajar de plan sin cobro (`PUT /api/suscripcion`, migración 006). Al bajar avisa qué módulos se dejan de tener; los datos no se borran |
| Foto con cámara | En Configuración, "Sacarme una foto" usa la cámara (getUserMedia, requiere https o localhost); la cámara se apaga al cerrar |
| Configuración | Reemplaza a Perfil (`/configuracion`; `/perfil` sigue andando). Editar nombre, apellido, nombre del negocio (PyME, también renombra el espacio) y foto (recortada a 256 px en el navegador, JPG/PNG/WebP, tope 400 KB, servida por `/api/perfil/foto`). Modo claro, oscuro o automático. Cambio de contraseña con la actual: cierra las demás sesiones. Migración 005 |
| Pagos y cobros futuros | Nuevo nombre de la sección antes llamada Gastos e ingresos futuros (ruta `/vencimientos`) |
| Tarjetas del Inicio | Cada una lleva a su detalle: Disponible a Movimientos hasta hoy, Pagos y Cobros a Gastos e ingresos futuros filtrados por tipo y próximos 7 días (en Gratis, a Movimientos programados), Cuota segura al Simulador. Los filtros viajan en la dirección (`?tipo=…&dias=7`) |
| Filtro de movimientos | Atajos (Todo, Hoy, Últimos 7 días, Este mes, Mes pasado, Programados), rango elegido y tipo, con los totales de lo filtrado. Lo resuelve el servidor (`desde`, `hasta`, `tipo`), hasta 1000 movimientos |
| Actualización automática | Inicio, Caja, Vencimientos y salud se recargan solos al registrar, importar o pagar algo, al volver a la ventana y cada minuto mientras está a la vista |
| Gastos e ingresos programados | Un movimiento cargado con fecha futura no baja el saldo hasta su día, pero entra en "Pagos de esta semana", en la proyección y en Vencimientos (marcado como programado, sin "Marcar pagado"). El día que llega se descuenta solo, porque el saldo suma los movimientos hasta hoy, y deja de figurar como pendiente |
| Simulador | Cuota, costo total, comparación de plazos y cuadro de cuotas. Guardar en rojo exige doble confirmación en el servidor |
| Avisos y escenarios | Avisos desde el plan Intermedio. Conservador y Estrés en el plan Full |
| Importar desde Excel | Botón "Importar gastos desde Excel" en el formulario de gastos (Movimientos y botón +). `.xlsx` y `.csv`, leídos en el navegador con `shared/importacion.ts` y validados de nuevo en el servidor. Reimportar no duplica, la carga se puede deshacer y respeta el límite del plan |
| Saldo y salud financiera en el Inicio | Saldo siempre visible y medidor de 0 a 100 en `shared/salud.ts`: lo que queda, días cubiertos, estabilidad y proyección. Sin 30 días de historia y 5 movimientos queda en gris |
| Historial automático en Caja | Se calcula de los movimientos, sin tabla ni carga aparte |
| Datos de la caja | Lo que entra y lo que sale se calculan solos con los movimientos de los últimos 90 días (`promediosDiarios`) y no se editan. Los pagos marcados en Vencimientos no se suman, porque ya están agendados. Solo se guarda la reserva. "Lo que te queda por mes" no se muestra: se calcula para la cuota segura y el simulador |
| Recuperar la contraseña | "¿Olvidaste tu contraseña?" en el ingreso. Enlace por mail de un solo uso que vence en 1 hora, con el token después del `#`. Al cambiarla se cierran todas las sesiones. Sin SMTP en `.env`, en desarrollo el enlace aparece en la terminal del servidor |
| Ver la contraseña | Ojito en todos los campos de contraseña (`CampoClave`) |
| Mercado | Dólar (DolarAPI), créditos y referencias (BCRA), plazo fijo, letras y fondos (ArgentinaDatos). En `server/mercado.ts`, con caché en memoria |
| Chatbot de ayuda | Gemini por `server/gemini.ts`, con la guía de `shared/ayuda.ts` como única base. Sin clave o si falla, responde esa misma guía por palabras clave |
| Interfaz | La de la web app anterior (`DISENO_UI.md` y `referencia/mockup_*.png`), en `src/anterior.css`: barra lateral, tarjeta "¿Te alcanza?" con el color del semáforo, 4 indicadores, gráfico con avisos, botón + con registro rápido y "Deshacer", y en el celular barra inferior con + y "Más". Entre 768 y 1280 px de ancho se muestra el mismo diseño a escala (`ANCHO_DISENO` en `Espacio.tsx`), sin diseño de tableta |

## Aislamiento

1. **Rutas:** el usuario sale solo de la cookie de sesión. Cada ruta busca el espacio entre los del usuario. Un espacio ajeno responde igual que uno inexistente (404).
2. **Base de datos:** Row Level Security en `perfiles`, `suscripciones`, `espacios_trabajo`, `movimientos`, `parametros_caja` y `compromisos`. La app se conecta con `cajaclara_v4_app`, que no es dueño de las tablas ni tiene `BYPASSRLS`. Cada transacción declara su usuario con `conUsuario()`; sin declararlo no se ve ninguna fila.

Toda consulta nueva sobre esas tablas tiene que pasar por `conUsuario()`. Toda tabla nueva con datos de un usuario tiene que nacer con RLS y una prueba en `tests/api.test.ts`.

## Sesiones y contraseñas

- Contraseñas con bcrypt (costo 12). Sesiones con token aleatorio; la base guarda solo su hash SHA-256.
- Cookie `httpOnly`, `SameSite=Lax` y `Secure` en producción. Verificación de origen en las escrituras.
- Límite de 20 intentos cada 15 minutos por IP en el alta y el ingreso.

## Decisiones para revisar

- Los precios y las funciones de cada plan salen de la sección 4.3 del informe y se pueden cambiar en la tabla `planes`. La landing los repite en su HTML.
- Como no hay cobro, elegir un plan pago habilita ese plan sin pagar.
- La publicidad es un anuncio de ejemplo: todavía no hay una red de anuncios conectada.

## Datos de mercado

Regla: solo datos reales. Si una fuente falla, se muestra el último dato con su fecha o nada. Nunca un valor de respaldo escrito a mano.

Bancos: créditos y plazo fijo muestran solo los 5 bancos con más depósitos (BCRA, cierre de 2025): Nación, Galicia, Santander, BBVA y Provincia, por nombre exacto. Una línea por banco y tipo: la de menor costo en pesos para todo público; si no hay, en pesos para un grupo; si no, UVA. Un banco sin línea vigente figura como "no informó". Las líneas con "UVA" en el nombre se tratan como UVA aunque la entidad las informe en pesos.

Créditos: las líneas del Régimen de Transparencia del BCRA se depuran en `depurarCreditos()`: solo pesos y UVA, informadas en los últimos 180 días, con CFT mayor a 0 y hasta 1000%. El BCRA no publica líneas específicas para PyMEs. Las líneas UVA se muestran aparte porque a su costo se le suma la inflación.

Fondos: el rendimiento compara la cuotaparte contra unos 30 días atrás. La fuente casi no publica historia de renta fija, así que esos fondos suelen figurar "Sin dato".

## Chatbot con Gemini

- **Clave:** `GEMINI_API_KEY` en `.env`, solo en el servidor. Modelo en `GEMINI_MODEL`, por defecto `gemini-3.5-flash-lite`.
- **Qué se envía:** la pregunta, hasta 6 mensajes previos, la guía, el tipo de usuario y el plan. Nunca nombre, email, ids ni cifras. Emails, CUIT, DNI, teléfonos y CBU se borran antes de enviar.
- **Qué no se confía:** la ruta se valida contra la lista y el plan, y si aparece una cifra que no está en la guía ni en la charla se descarta la respuesta.
- **Respaldo:** sin clave, con errores, tiempo agotado o pasadas 30 preguntas cada 10 minutos por usuario, responde la guía local. Saludos y pedidos de consejo nunca llegan a Gemini.
- **Privacidad:** en el nivel gratuito de Gemini, Google puede usar el contenido para mejorar sus productos y puede ser leído por revisores. Para producción hace falta el nivel pago.

Guía local medida con frases nuevas: 21 de 36 (58%) y luego 25 de 38 (66%). Las mismas frases sirven para medir a Gemini cuando esté la clave.

## Pendiente

- Módulos que el Inicio muestra como próximos: metas, asistente con IA e informes.
- Quien registra su plata inicial como ingreso infla "lo que te queda" durante 90 días: falta un tipo de movimiento "saldo inicial".
- Registro por voz y foto, importación de CSV y avisos por WhatsApp, que existían en la V1.
- Verificar el email al registrarse.
- Cambiar de plan después del alta y cobrar.
- Consentimiento y política de datos (Ley 25.326).
