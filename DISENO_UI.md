# Guía de diseño UI · Caja Clara

Objetivo: una app **intuitiva, agradable y moderna**, que un dueño de una panadería entienda en 5 segundos y sin saber de finanzas. Esta guía **reemplaza** la sección 5 de `ESPECIFICACION.md`. La maqueta de referencia está en `referencia/mockup_ui.html` (con capturas en `referencia/mockup_escritorio.png` y `referencia/mockup_celular.png`).

## 1. Principios
1. **Responder primero, detallar después.** La pantalla de inicio abre con una frase grande que contesta "¿me alcanza?" (por ejemplo, "Sí, te alcanza, pero el sáb 1/11 quedás $185.000 debajo de tu reserva"), y abajo van los números.
2. **Una acción principal por pantalla.** El botón destacado siempre es el siguiente paso lógico: registrar, simular o marcar pagado.
3. **Registrar en 1 toque.** Un botón flotante **+** está siempre visible, abre una hoja inferior con el micrófono como acción principal, y desde ahí también se accede a la foto y al texto.
4. **Lenguaje humano.** Nada de "saldo proyectado mínimo": decir "Tu peor día". Montos grandes en formato compacto ($3,8 M) y el valor completo al tocar o pasar el mouse.
5. **El color acompaña, no reemplaza.** El semáforo siempre lleva ícono y texto, además del color.

## 2. Estructura y navegación
- **Escritorio (≥ 1024 px):** barra lateral fija de 240 px a la izquierda, con logo, selector Negocio/Personal (control segmentado), 7 ítems con ícono y la tarjeta del plan abajo. El contenido va centrado con un máximo de 1200 px.
- **Celular (< 768 px):** barra inferior con 5 pestañas: Inicio, Movimientos, **+** (botón central elevado), Calendario y Más. "Más" abre una hoja con Simulador, Informes, Asistente y Ajustes. El encabezado es compacto, con saludo, selector de espacio y avatar.
- **Tableta:** barra lateral colapsada, solo con íconos.
- Transición entre pantallas: fundido con desplazamiento de 8 px en 200 ms.

## 3. Tokens de diseño (variables CSS, con modo claro y oscuro)
| Token | Claro | Oscuro |
|---|---|---|
| `--bg` | `#f4f7f8` | `#0e1a20` |
| `--surface` | `#ffffff` | `#15242c` |
| `--surface-2` | `#eef3f5` | `#1c2f38` |
| `--ink` | `#14232e` | `#e8f0f2` |
| `--muted` | `#5f7180` | `#93a8b4` |
| `--line` | `#e2e9ec` | `#25404b` |
| `--brand` | `#0a7c7e` | `#2bc4bb` |
| `--brand-soft` | `#e3f4f3` | `#123a3c` |
| `--ok` / `--ok-soft` | `#16a34a` / `#e8f7ee` | `#34d399` / `#123a2a` |
| `--warn` / `--warn-soft` | `#d97706` / `#fff4e0` | `#fbbf24` / `#3a2f12` |
| `--bad` / `--bad-soft` | `#dc2626` / `#fdecec` | `#f87171` / `#3d1a1a` |
| `--unknown` | `#94a3b8` | `#64748b` |

- **Tipografía:** Inter (Google Fonts), con la del sistema como respaldo. Escala: 32/24/20/16/14/12. Números con `font-variant-numeric: tabular-nums`. Títulos en 650 y montos destacados en 700.
- **Espaciado:** múltiplos de 4 (4, 8, 12, 16, 24, 32, 48).
- **Radios:** tarjetas 20 px, botones y campos 12 px, píldoras 999 px.
- **Sombras:** `0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06)`. En modo oscuro, sin sombra y con borde.
- **Íconos:** `lucide-react` (única librería de UI permitida además de React), de 20 px y trazo 1,75.
- **Modo oscuro:** automático según `prefers-color-scheme`, con un interruptor en Ajustes.

## 4. Componentes
- **Tarjeta Hero ("¿Te alcanza?")**: fondo con degradé suave del color del estado (verde, ámbar, rojo o gris), un ícono grande del estado, la frase-respuesta en 24 px y, debajo, el peor día y la acción sugerida como botón. Reemplaza al semáforo de 3 luces.
- **Indicadores (KPI)**: 4 tarjetas pequeñas con ícono en círculo `--brand-soft`, etiqueta en 12 px, valor en 24 px con formato compacto y una variación o comentario en 12 px.
- **Gráfico de caja**: área con degradé bajo la línea, línea de reserva punteada con etiqueta, punto destacado en el peor día, y tooltip al pasar el mouse o tocar (fecha, saldo y movimientos del día). Arriba, un control segmentado Base / Conservador / Estrés.
- **Alertas**: tarjetas con ícono de color a la izquierda, título en negrita, una línea de detalle, botón principal (por ejemplo, "Reprogramar") y 👍/👎 discretos a la derecha. Se pueden descartar deslizando en el celular.
- **Hoja de registro rápido** (desde el botón +): micrófono grande en el centro con animación de ondas al grabar, botones para foto y escribir, y debajo la **propuesta como tarjeta editable**, con chips de categoría (se toca para cambiar) y el botón "Confirmar". Después de confirmar, mostrar un toast "Registrado · Deshacer" durante 5 s.
- **Movimientos**: lista agrupada por día ("Hoy", "Ayer", "lun 26/10"), con avatar de categoría (ícono y color), concepto, origen (ícono pequeño de micrófono, cámara o CSV) y monto alineado a la derecha. Búsqueda y filtros como chips.
- **Calendario**: alternar entre vista de mes (grilla con puntos de color por día) y vista de lista agrupada. Cada ítem tiene un checkbox circular para marcar como pagado (con animación de tilde) y un menú "⋯" (+7 días, ver aviso, eliminar).
- **Simulador**: formulario en 3 pasos (¿Qué querés comprar? → ¿Cómo lo pagás? → Resultado). Las cuotas se eligen con un **control segmentado** (3, 6, 12, 18 o 24) y el anticipo con un **slider** y campo numérico. El resultado muestra un **medidor semicircular** del % del margen (0–30 verde, 30–40 ámbar, más de 40 rojo), la cuota en grande, el veredicto en una frase y la comparación como tarjetas horizontales que se pueden tocar para elegir.
- **Asistente**: interfaz de chat con burbujas, sugerencias como chips arriba del campo de texto y un indicador de que está escribiendo. Las cifras dentro de la respuesta van en negrita.
- **Informes**: tarjetas con barras horizontales por categoría, "Real" y "Proyectado" como pestañas, y botones de acción en la parte superior (PDF, CSV, Enviar).
- **Ajustes**: secciones agrupadas tipo lista (como en iOS), con interruptores, el plan como tarjetas comparativas y la clave de IA con estado ("Conectado ✓").
- **Alta (empezar de cero)**: asistente de 3 pasos a pantalla completa, con barra de progreso, una pregunta por pantalla, botones grandes y un resumen final antes de crear.
- **Estados vacíos**: ícono grande, una frase y un botón (por ejemplo, "Todavía no registraste nada hoy · Registrar").
- **Carga**: esqueletos (bloques que brillan), nunca pantallas en blanco.

## 5. Movimiento y accesibilidad
- Transiciones de 150 a 250 ms con `cubic-bezier(.2,.8,.2,1)`. Los números importantes se animan al cambiar (de 300 a 500 ms). Respetar `prefers-reduced-motion`.
- Contraste AA en todos los textos. Objetivos táctiles de 44 px como mínimo. Foco visible con anillo `--brand`. Etiquetas `aria` en botones de solo ícono. El orden de tabulación debe seguir el orden visual.

## 6. Criterios de aceptación de diseño
- [ ] Una persona nueva entiende en 5 segundos si "le alcanza", sin leer números.
- [ ] Se puede registrar un gasto en 2 toques (+ → micrófono → confirmar).
- [ ] Sin desbordes a 375 px. La barra inferior y el botón + no tapan contenido (respetar `safe-area-inset`).
- [ ] Modo claro y oscuro correctos en las 7 pantallas.
- [ ] Lighthouse con Accesibilidad ≥ 95 y Buenas prácticas ≥ 95.
- [ ] Walkthrough con capturas de escritorio y celular, en claro y en oscuro.
