# Keynest

**Gestión de inmuebles para anfitriones de Airbnb**: reservas, limpiezas, cerraduras y rentabilidad en una sola app autoalojada.

Keynest es una PWA + backend Node que sincroniza tus calendarios de Airbnb (iCal), genera y gestiona limpiezas con checklist por inmueble, administra tareas de mantenimiento y calcula la rentabilidad por inmueble. Pensado para autoalojarse en un servidor pequeño (LXC, Raspberry Pi…).

## Funciones

- **Reservas**: sincronización iCal automática con Airbnb (cada 15 min + manual), calendario con semántica entrada/salida/estancia, importe manual y notas por reserva.
- **Limpiezas**: se crean desde las salidas (nunca en fechas ocupadas, margen configurable), **instrucciones + checklist por inmueble**, hasta 2 limpiadoras asignadas, **enlaces token** para el personal (sin cuenta), fotos desde el móvil, coste = horas × tarifa + productos.
- **Mantenimiento**: kanban con arrastrar y soltar, maestro de categorías, tareas editables.
- **Multiidioma**: interfaz completa ES/EN, idioma por usuario (`auto` = navegador).
- **Auth**: multiusuario con sesiones bcrypt, cambio de contraseña, modo demo (datos de muestra con un clic, BD separada, desactivable).
- **Autoalojado**: un solo proceso Node + SQLite, servicio systemd endurecido.

## Stack

React 19 + Vite + Tailwind · Hono + better-sqlite3 · react-i18next · Sin Docker.

## Desarrollo

```bash
cd server && npm install && cp .env.example .env && npm start
cd app && npm install && npm run dev
cd server && npm test      # tests
cd app && npm run lint     # lint
```

## Instalación (one-liner, cualquier Linux con systemd)

```sh
curl -fsSL https://raw.githubusercontent.com/gnacho/keynest/main/install.sh | sh
```

Instala el runtime Node 22 versionado + la última release estable (frontend
pre-compilado, `node_modules` de producción por arquitectura — el servidor no
necesita compilador) como servicio systemd sandboxed en `/opt/keynest`
(estilo capistrano: `releases/` + symlink `current`). Datos en
`/var/lib/keynest`, config en `/etc/keynest/env` (0600) con contraseña de
admin aleatoria que se muestra una sola vez. Si el puerto por defecto (8081)
está ocupado, se usa el siguiente libre automáticamente. Re-ejecuta el script
para actualizar; `--uninstall` desinstala limpio (conserva datos, `--purge`
los borra). Cada descarga se verifica contra `checksums.txt` (sha256).

## Licencia

[AGPL-3.0](LICENSE)
