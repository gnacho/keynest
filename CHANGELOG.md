# Changelog

Todos los cambios notables de Keynest se documentan en este fichero.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/),
y este proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

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
