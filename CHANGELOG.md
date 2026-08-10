# Changelog

Todos los cambios notables de Keynest se documentan en este fichero.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/),
y este proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Todo

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
