# Changelog

Todos los cambios notables de Keynest se documentan en este fichero.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/),
y este proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

## [1.5.39] - 2026-08-29

### Fixed

- Adds Umami analytics tracker to the landing page (#239).

## [0.1.8] - 2026-08-28

### Changed

- Un check de actualizaciones fallido deja de ser invisible (#231): si el
  server no puede consultar GitHub (p. ej. el límite de peticiones por IP),
  el ribbon muestra un aviso discreto con botón de reintentar, en vez de
  degradar en silencio a "sin novedades". El estado del server distingue
  "al día" de "no se pudo comprobar".

## [0.1.6] - 2026-08-28

### Added

- Asistente de actualización con changelog y progreso paso a paso (#232):
  al pulsar "Actualizar ahora" se abre un diálogo con el par de versiones,
  las novedades de la release, los pasos en curso (comprobando, descargando,
  verificando, instalando, reiniciando) con barra de porcentaje y recarga
  automática al volver. Una sesión caducada se explica en el diálogo en vez
  de redirigir en silencio al login.
- Código de emparejamiento de un solo uso para renovar la sesión de AirBnB
  del scraper desde la propia web (#227): sin tocar el servidor, con
  caducidad y uso único reforzados en el server.

### Fixed

- Fuentes self-hosted (#230): Inter y Space Grotesk se sirven desde la propia
  instalación (woff2 local); la CSP deja de bloquearlas y no hay peticiones
  a fonts.googleapis.com.

## [0.1.4] - 2026-08-24

### Added

- Tracker GoatCounter opcional en la demo pública: el build con `VITE_GC_COUNT`
  inyecta el snippet con prefijo `/demo` y el CSP acepta el origen del tracker
  solo cuando se define `GC_ORIGIN`. Los builds normales no llevan tracker:
  una instalación self-hosted nunca llama a casa. (#224)

## [0.1.2] - 2026-08-23

### Changed

- El tag HOY/MAÑANA del resumen pasa a una ranura fija a la izquierda de la
  chapa de fecha (y del chip Entrada/Salida): todas las filas de entradas,
  salidas y mismo día quedan con las columnas alineadas. (#225)
- El aviso "Aviso de pago (mis inmuebles)" tras un check-in llega solo a los
  dueños del inmueble, no a todos los usuarios. (#223)

## [1.5.47] - 2026-08-16

### Fixed

- El diálogo de edición de limpieza ya no parpadea (desaparece y reaparece) al
  interactuar con las horas, la asignación o las fotos: los diálogos ahora se
  montan fuera del árbol animado de la tarjeta. (#211)

## [1.5.46] - 2026-08-16

### Changed

- El checklist del diálogo de edición de limpieza fluye en columnas según el
  ancho: hasta 3 columnas en el diálogo ancho (≥260px por columna) y una sola
  en móvil. (#211)

## [1.5.45] - 2026-08-16

### Changed

- El diálogo de edición de limpieza apila sus tarjetas internas (checklist,
  instrucciones, asignación, fotos) a **ancho completo** en vez de dos
  columnas, aprovechando el nuevo ancho del diálogo. (#211)

## [1.5.44] - 2026-08-16

### Fixed

- El diálogo de edición de limpieza ahora **sí** crece en escritorio: la clase
  base del componente (sm:max-w-lg) ganaba al ancho anterior, dejándolo sin
  cambio. Ahora se fuerza `max-w-[min(1024px,94vw)]` (≈1024px, antes 672px) con
  el reflow a dos columnas; el diálogo de confirmación pasa a ≈768px (antes
  448px). El móvil mantiene el ancho casi completo. (#211)

## [1.5.43] - 2026-08-16

### Added

- Ajustes: la zona de administración es colapsable (botón chevron en su cabecera,
  se recuerda la preferencia), de modo que la página llega a todas las secciones
  sin largos desplazamientos en escritorio. (#44)
- Navegación móvil por gesto: deslizar horizontalmente sobre el contenido cambia
  de menú (izquierda = siguiente, derecha = anterior) reutilizando la transición
  de vista existente. Los gestos verticales se ignoran para convivir con el
  pull-to-refresh. (#173)

## [1.5.42] - 2026-08-16

### Changed

- Las limpiezas pueden eliminarse en **cualquier estado** (en curso, archivadas
  o con horas/productos/fotos registrados), con un diálogo de confirmación que
  avisa de que se descartan esos datos y el gasto de limpieza vinculado. La
  reserva de origen no se toca. (#210)

## [1.5.41] - 2026-08-16

### Added

- El diálogo de edición y confirmación de limpieza es más ancho en escritorio y
  tableta, con dos columnas en pantallas grandes (checklist+instrucciones a la
  izquierda, asignación+fotos a la derecha; horas | productos en la
  confirmación). El móvil mantiene la pila vertical. (#211)
- Las reservas creadas a mano pueden editarse y eliminarse desde su fila
  expandida, con confirmación de borrado. Las del iCal/CSV siguen siendo solo
  lectura (su fuente es Airbnb). (#165)
- La tarjeta de previsión del mes del resumen ahora se titula "Mis inmuebles ·
  Previsión mes". (#159)
- El filtro de categoría de Mantenimiento pasa de chips con iconos a un
  desplegable con etiquetas (icono + texto). (#110)
- Al arrastrar una tarjeta en el Kanban de Mantenimiento, la copia que se mueve
  es más grande y con sombra (se lee como "la que se mueve"). (#109)
- Comprobaciones previas a la actualización (`readiness`): espacio en disco,
  permisos de escritura, sin actualización en curso y que el asset de la
  release sea alcanzable. El botón "Actualizar" se deshabilita si algo falla. (#155)
- Botón "Revertir a la anterior" para deshacer una actualización restaurando el
  backup previo (layout plano o Capistrano). (#154)

## [1.5.40] - 2026-08-15

### Added

- Nuevo tipo de gasto `limpieza` (label "Limpieza") en el desplegable de gastos,
  disponible también para alta manual sin limpieza asociada. (#209)
- Al confirmar una limpieza (admin o personal con token) se crea automáticamente
  un gasto "Limpieza" vinculado a ella con su coste real (horas × €/h de cada
  persona + productos). Editar la limpieza archivada recalcula el gasto;
  eliminarla elimina el gasto. La migración 22 añade la columna
  `source_cleaning_id` a `expenses`. (#209)
- Se retira el gasto "Extras" de productos que se creaba manualmente al
  confirmar: los materiales ya quedan incluidos en el gasto de limpieza. (#209)

## [1.5.39] - 2026-08-15

### Added

- Gastos persistentes: nueva tabla `expenses` en el servidor con CRUD completo
  (crear, editar, eliminar). Antes vivían solo en memoria del navegador y se
  perdían al recargar. La migración usa el número 21 porque el 20 ya estaba
  ocupado en el servidor de producción por un cambio de otra sesión. (#207)
- Rentabilidad gana la sección "Todos los gastos": filtros por tipo, inmueble,
  mes y año, búsqueda por texto y paginación de 20 por página. Los filtros de
  mes/año abren por defecto en el mes y año actuales. El desglose por tipo
  (quesito) se mantiene como resumen. (#207)
- El botón "Eliminar gasto" vive dentro del diálogo de edición, en acento
  rojo, para evitar borrados accidentales desde las filas. (#207)
- La demo online incluye gastos de ejemplo. (#207)

### Fixed

- El botón "Editar" de una limpieza archivada no abría ningún diálogo (estaba
  conectado a un diálogo que solo se renderiza para limpiezas activas). Ahora
  abre el editor de horas y productos de esa limpieza. (#206)

## [1.5.38] - 2026-08-15

### Added

- Navegación móvil con deslizamiento: al cambiar de vista desde la bottom-nav
  el contenido se desliza direccionalmente (adelante/atrás según el orden del
  menú) con la View Transitions API; header y barra inferior permanecen
  estáticos y se respeta `prefers-reduced-motion`. El re-tap del tab activo
  conserva el scroll suave arriba sin animación. (#198)

### Changed

- En las tarjetas de movimientos del resumen, cuando un inmueble tiene
  rotación HOY (salida + entrada el mismo día) el badge HOY pasa a la
  izquierda, delante del aviso de rotación y de la fecha. (#199)
- Ajustes más compactos en móvil: se ocultan nombre/email en "Mi perfil" y
  nombre/rol en el panel de Usuarios (no cabían en la fila). (#200)
- La tarjeta de Tedee se titula solo "Tedee" y el chip de conexión muestra
  únicamente el punto de estado. (#201)
- La tarjeta de importación se titula "Airbnb" y su botón es solo icono. (#202)

### Fixed

- La tarjeta "Instalar aplicación" ya no aparece cuando la PWA ya está
  instalada. (#203)
- La PWA no giraba en tablets: el manifest forzaba orientación vertical
  (`portrait-primary`). Ahora usa `any` para rotar con el dispositivo. (#194)
- El path del marcador de versión instalada (`release-id`) estaba hardcodeado
  a `/opt/keynest`; ahora es configurable vía `RELEASE_MARKER` (importante en
  despliegues flat/demo donde la ruta no existe y el `build` caía al fallback
  del package.json). (#196)

## [1.5.33] - 2026-08-11

### Added

- Resumen con dos tarjetas KPI consolidadas: movimientos (entradas, salidas,
  limpiezas) y visión del mes (ocupación con sparkline, ingresos previstos,
  reservas). Lado a lado desde el breakpoint `sm` para que quepan en plegables
  desplegados tipo OnePlus Open. (#167, #174, #175, #182)
- Topbar con el usuario a la derecha (avatar + nombre → Ajustes), orden
  tema / campana / usuario; en móvil solo el icono y sin punto de conexión.
  (#181)
- Al navegar, la vista nueva arranca arriba (scroll reset); re-tocar el tab
  activo de la barra inferior o el logo hace scroll suave al principio. (#184)

### Fixed

- Filtros de Reservas y Limpieza en una sola fila en desktop y en dos filas en
  móvil; el estado activo queda en una segunda línea. (#176)
- Rentabilidad: elegir "Todos los inmuebles" en el desplegable desactiva el
  filtro "Mis inmuebles". (#178)
- Limpieza: la vista archivada ya no se desborda horizontalmente en móvil y el
  filtro de estado por defecto es "Pendientes". (#169, #170)
- Hoja de estadísticas del inmueble responsive en todas las pantallas. (#172)
- El botón de crear inmueble pasa al final de la página. (#171)
- "Acerca de" con enlaces a Ko-fi, la web propia y el club. (#179, #180)

## [1.5.5] - 2026-08-10

### Added

- Las tareas de mantenimiento pueden asignarse a usuarios de la app, no solo a
  proveedores externos. La asignación es mutuamente excluyente: al asignar un
  usuario se limpia el proveedor y viceversa. (#161)
- Recordatorios push de mantenimiento: el día antes y el mismo día de la fecha
  prevista, se envía una notificación al usuario asignado. Nuevo toggle en las
  preferencias de notificación. (#161)

- **Auditoría de seguridad y robustez** (release bug-hunting): revisar auth y
  sesiones, CSRF/Origin check, cabeceras de seguridad HTTP, path traversal,
  secretos cifrados (ENC_KEY/SESSION_SECRET), rate-limit y body caps, y bugs
  latentes. Cada hallazgo se materializa en su propio issue/PR.

### Fixed

- **Sync iCal: un UID compartido entre dos inmuebles ya no migra la reserva**
  a la otra propiedad (el `ON CONFLICT(uid)` sobreescribía `property_id`).

## [1.5.2] - 2026-08-10

### Changed

- Botón de tema movido del footer del sidebar a la topbar, con selector
  segmentado de tres modos (Automático / Claro / Oscuro) como en Helios.
  Los textos se ocultan en pantallas pequeñas.

## [1.5.0] - 2026-08-06

### Added

- Ajustes y menú al canon de webapp-shell con sincronización en tiempo real (SSE).
- AdminBar canónica: Actualizaciones → Respaldos → Usuarios → Modo demo, con auditoría.
- Landing pública y seed de demo enriquecido.
- Recuperar y copiar el enlace de acceso por token del personal de limpieza.
- Anti pantalla-negra tras despliegue (webapp-shell, decisión 12).
- Sincronización iCal: conservar reservas finalizadas y empty state según lookahead.

### Fixed

- **Body cap global de 11 MB** en todas las rutas (los endpoints JSON se
  parseaban sin límite; los uploads de fotos ≤10 MB siguen permitidos).
- **Cambio de contraseña invalida las demás sesiones** del usuario (la
  actual sobrevive): un dispositivo con la contraseña vieja se desconecta.

### Changed

- **Migración del toolchain de build**: Vite 7 → 8 (Rolldown), @vitejs/plugin-react 5 → 6, Tailwind CSS 3 → 4 (config en CSS vía `@theme`, plugin Vite `@tailwindcss/vite`).
- **React Router 7 → 8.3.0**: imports migrados de `react-router-dom` a `react-router`.
- **Backend**: @hono/node-server 1.x → 2.1.0, mejoras de seguridad en auth y validación de fotos.

### Fixed

- **Vulnerabilidad HIGH (CSRF en modo RSC)**: GHSA-qwww-vcr4-c8h2, afectaba a react-router 7.12.0–8.2.0; cerrada con react-router 8.3.0.
- Subir foto de inmueble devolvía 500 (d.name indefinido).

## [1.4.0] - 2026-08-01

### Added

- Tarjeta "Mi perfil" horizontal con avatar, nombre visible y email en el backend.

## [1.3.2] - 2026-07-31

### Added

- Auto-purga de fotos de limpieza expiradas y mejoras de UI.

## [1.3.1] - 2026-07-30

### Changed

- PhotoCropDialog v2 con 8 mejoras de recorte y compresión.

## [1.3.0] - 2026-07-29

### Added

- Tarjeta de configuración de respaldos en Ajustes de admin.
- Refuerzo de seguridad: auth endurecida, sistema de respaldos, rate limits y validación de fotos.

## [1.2.1] - 2026-07-28

### Fixed

- Clave de cifrado endurecida, rate-limit por IP y raíz de estáticos segura.

## [1.2.0] - 2026-07-27

### Added

- Recorte 4:3 → WebP para fotos de inmuebles y zona de admin separada en Ajustes.

### Fixed

- Subir foto de inmueble devolvía 500.

## [1.1.1] - 2026-07-26

### Fixed

- Sección `time.*` de i18n que faltaba: claves crudas visibles en la sincronización iCal.

## [1.1.0] - 2026-07-25

### Added

- `properties.tedee_lock_id` para mapear cerradura ↔ inmueble.
- Tarjeta Tedee como estado de salud.
- Colores de estado de reserva: activa verde, completada gris.
- Estado "activa" en reservas en curso y fecha real de reserva.
- Diálogo de mantenimiento más ancho y sin scroll.

## [1.0.0] - 2026-07-22

### Added

- Instalador one-liner y releases estables por arquitectura.
- Shell webapp-shell (raíl md, Ajustes al pie, DemoBanner) y tokens canónicos con tema tri-estado y densidad.
- Gestión completa de usuarios admin (rol, password, idioma, borrado).
- Login con guardado de credenciales del navegador.
- Visor de fotos con swipe/teclado; limpiezas archivadas ocultas por defecto.
- Token Tedee cifrado (AES-256-GCM), audit log, preferencias en BD y cliente HTTP consolidado.
- Actualización desde la app solo para admin (estado + auto-restart).
- Importadores CSV de Airbnb (huésped + importe + histórico).
- API pública de Tedee (modo dual bridge/cloud).
- Rentabilidad con filtros de periodo, proveedores con token por orden de trabajo, limpiezas sin límite de antelación.
- README EN/ES, CI de build + release y workflow gitleaks.
- App completa: backend Hono+SQLite, i18n ES/EN, modo demo, iCal Airbnb, limpiezas y mantenimiento.
