# DESIGN — Landing de Keynest

## Qué es (artefacto y audiencia)

- **Artefacto**: landing page de marketing de producto self-hosted (estática, sin
  build, HTML+CSS+JS puro, como easyzfs/landing y netpulse/web).
- **Producto**: Keynest, gestor de alquileres de media estancia para carteras
  familiares sin límite de pisos (la app no pone tope). Reservas sincronizadas
  desde Airbnb por iCal, limpiezas generadas de los check-outs con checklist y
  enlaces token para el personal, mantenimiento en kanban, cerraduras Tedee y
  rentabilidad por inmueble. Un servicio Node + SQLite, self-hosted, sin nube,
  sin suscripción.
- **Audiencia**: pequeños propietarios que hoy se apañan con Excel y WhatsApp.
  Gente normal, no gestores profesionales ni empresas de turismo. Ven la app en
  el móvil; la instalan en un mini-PC o LXC.
- **Objetivo único**: que prueben la demo / descarguen e instalen. La landing
  debe hacer entender EN 5 SEGUNDOS qué resuelve y por qué es diferente de
  Smoobu/Guesty/Lodgify/Hostaway/Beds24.

## Adjetivos (commit-to-words, 5-Ago-2026)

- **Desenfadado** → copy con chispa y humor ligero, emojis NO (solo iconos),
  frases cortas, jerga de la casa ("la cartera familiar", "sin Excel que
  llore").
- **Cercano** → no vender humo: "para la cartera familiar, no para 300".
  Familia, no corporación.
- **Ligero** → visual limpio, blanco, mucho aire. La app pesa ~30 MB y corre en
  cualquier mini-PC; la landing debe respirar igual.
- **Rigor funcional** → el acento real de la página está en las
  FUNCIONALIDADES (las 8 vistas), no en slogans vacíos. Claims todos
  verificados en el código.
- **Honesto** → comparativa con lado honesto; "what to expect" sin prometer
  roadmap.

Esencia de 3 palabras: **"funcional, cercano, con salero"**.

## Aesthetic commitment

Landing **blanca luminosa** (claro por defecto) con acento índigo marca de la app
(#6366F1→#8B5CF6). NO es la web "crema corporativa" de EasyZFS: Keynest es más
**cálida y con personalidad**, más redondeada, con más color semántico heredado
de la propia app (entradas=emerald, salidas=amber, estancia=blue). El toque
divertido lo dan los **emojis-semánticos en las features y el tono del copy**,
no el layout.

Tono del layout: **cálido pero sobrio**. Tarjetas con radius 16, un solo borde
(sin doble sombra), acento índigo solo en CTAs/links/foco, colores semánticos
para el estado de las cosas (verde=nueva entrada, naranja=salida, violeta=
limpieza, rosa=mantenimiento, tal y como los usa la app).

## Tipografía

- Display: **Space Grotesk** (400-700). Es la fuente de la app (font-display),
  da carácter técnico-amigable.
- Body: **Inter** (400-600). Igual que la app.
- Mono: **JetBrains Mono** (para el comando de instalación y métricas).
- Google Fonts, preconnect, 2 familias (Space Grotesk + Inter + JetBrains Mono
  para el codebox = 3 ficheros).

## Color (OKLCH sobre RGB para la web, patrón webapp-shell)

Claro (default):

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#F8FAFF` | fondo de página |
| `--surface` | `#FFFFFF` | tarjetas |
| `--border` | `#E3E8F0` | bordes |
| `--text` | `#0C1425` | texto principal |
| `--text-muted` | `#5B6B84` | texto secundario |
| `--accent` | `#4446E0` (indigo oscurecido para AA ≥4.5) | CTA principal, links |
| `--emerald` | `#059669` | entrada/ocupado/ok |
| `--amber` | `#B45309` (oscurecido AA) | salida/warn |
| `--blue` | `#2563EB` | estancia/info |
| `--violet` | `#7C3AED` | limpieza |
| `--rose` | `#E11D48` | mantenimiento/urgente |

Oscuro (diseñado, no invertido):

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#0B1220` | fondo |
| `--surface` | `#111C33` | tarjetas |
| `--border` | `#1E2B42` | bordes |
| `--text` | `#E9EEF7` | texto |
| `--text-muted` | `#93A1B8` | secundario |
| `--accent` | `#818CF8` | CTA principal |
| semánticos | versiones 400/300 más claras | estado |

Contraste AA verificado en ambos temas (audit de tokens con script, no a ojo).

## Signature move

**La barra de estancia**: en las tarjetas de features y en el hero hay una barra
horizontal con los 3 tramos de una estancia típica — `entrada (emerald) →
estancia (blue) → salida (amber)` — con etiquetas pequeñas. Es la única
decoración "dibujada" de la web y dice en una imagen lo que la app hace: la
estancia del huésped, del check-in al check-out, y todo lo que la rodea
(limpieza, mantenimiento, rentabilidad). Aparece en el hero, en la sección de
funciones y como separador.

Alternativa desechada: mascota/ilustración grande (resta seriedad al producto
de software).

## Craft layer

- **Layout**: hero a ancho completo → features en filas horizontales (icono +
  título + texto, como EasyZFS, decisión del usuario) → capturas slider →
  comparativa matriz por bloques → instalación (tarjeta única + requisitos) →
  acerca de honesto → footer. Secciones con mucho aire (`padding 88px`).
- **Buttons**: un solo primario por vista (índigo), secundarios ghost. Estados
  completo: hover, focus visible (outline 2px accent), active, disabled n/a.
- **Slider de capturas**: imagen principal + flechas prev/next + miniaturas
  clicables; idioma+tema cambian la captura (JS). Alt descriptivo por vista.
- **Comparativa**: matrices por bloque de funcionalidades con leyenda
  ✓ nativo / ◐ parcial / ✗ no / — n/a. Columna Keynest resaltada a la izquierda.
  Lado honesto al final.
- **Motion**: transiciones 150-250ms ease-out solo opacity/transform; reveal on
  scroll con IntersectionObserver; `prefers-reduced-motion` → estático.
  Cero bounce, cero animaciones infinitas.
- **Dark mode**: diseñado (surface elevada por luz, no invertido), toggle en el
  nav, default claro.
- **A11y**: skip link, un solo h1, jerarquía de headings, aria-label en
  controles no textuales, targets ≥40px, foco visible.
- **Imágenes**: capturas reales de la app en modo demo (WebP 1440), nunca
  mockups. Favicon = logo real de la app (SVG inline).

## Implementación

- Ficheros: `index.html`, `styles.css`, `i18n.js`, `app.js`, `og.png`,
  `robots.txt`, `sitemap.xml`, `assets/shot-*.webp`.
- Assets con `?v=N` para romper caché.
- Sin framework, sin npm, sin build.
