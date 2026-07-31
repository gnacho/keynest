# Plan — Mockup PWA "Gestor de Inmuebles Airbnb"

## Objetivo
Mockup navegable (frontend-only, datos mock deterministas) de la PWA de gestión de inmuebles Airbnb,
siguiendo el skill del usuario `webapp-stack` (adjunto): React 18 + Vite + Tailwind 3 + shadcn/ui + recharts,
provider síncrono de datos, tokens de diseño, layout app-like (sidebar desktop / bottom-nav móvil), tema claro/oscuro.

## Stack (del skill del usuario)
- React 18 + Vite 7 + Tailwind 3 + shadcn/ui (solo componentes usados) + recharts
- Datos mock en DataProvider síncrono (contrato como el del skill: version/bump, sin HTTP en componentes)
- Tipografía: Space Grotesk (KPIs/titulares) + Inter (UI), formato es-ES
- Tokens CSS claro/oscuro del skill, tarjetas 16px radius, transiciones fade+y8
- Semántica de color del dominio: entradas=verde, salidas=naranja, estancias=azul, desocupado=neutro

## Etapas

### Stage 1 — Orquestación y scaffolding (skill: vibecoding-webapp-swarm)
- Cargar skill vibecoding-webapp-swarm y seguir su workflow
- Setup del proyecto React+Vite+Tailwind en worktree/entorno de trabajo
- Design system: tokens CSS, fuentes, layout (sidebar 232px / bottom-nav 64px + safe-area)

### Stage 2 — Datos mock + Provider
- DataProvider síncrono con dataset determinista (semilla): 4-5 inmuebles, reservas ~2 meses,
  accesos Tedee, tareas limpieza/mantenimiento, gastos, personas
- KPIs computados desde los datos (regla del skill: nunca escritos a mano)

### Stage 3 — Vistas (8 pantallas)
1. Login (mock)
2. Dashboard: ocupación actual, próximas entradas/salidas, alertas limpieza, accesos Tedee, rentabilidad rápida
3. Calendario mensual: colores por tipo, filtros inmueble/tipo, días fuera de mes oscurecidos, click → detalle reserva
4. Reservas: lista con huésped, fechas, estado, peticiones especiales
5. Tedee: registro de accesos por inmueble
6. Limpieza: tareas, asignación (hasta 2 personas), checks con fotos, cálculo coste automático
7. Mantenimiento: tarjetas de tareas con estados Nueva→Asignada→Finalizada, etiquetas, urgente, deslizar para finalizar
8. Rentabilidad: barras + quesito, comparativa período anterior, desglose por inmueble, alta de gasto
9. Maestros/Ajustes: inmuebles (solo lectura + tuerca), personas, tipos de gasto

### Stage 4 — PWA + build + entrega
- manifest.webmanifest, theme-color dinámico, icono
- Build de producción, verificación visual (screenshots desktop + móvil)
- Entrega con mshtools-website_version_manager (build_version, type: static)

## Asignación de sub-agentes
- 1 coder principal (build completo del mockup) — tarea grande pero cohesiva; dividir en
  componentes compartidos + vistas si el skill swarm lo indica
- Verificación visual por el orquestador (screenshots)
