# Research / Spec — PWA Gestor de inmuebles de alquiler (MOCKUP)

Mockup navegable frontend-only con datos mock realistas y coherentes (KPIs computados desde los datos, nunca hardcodeados; mock determinista con semilla). Idioma de la UI: español (es-ES). Formato números: coma decimal, miles con punto, moneda EUR.

## Vistas requeridas (9)
1. **Login** (mock, simple, branding app)
2. **Dashboard**: resumen ocupación actual, próximas entradas/salidas, alertas de limpieza pendiente, accesos recientes Tedee, rentabilidad rápida del mes
3. **Calendario**: vista mensual completa (semanas lun-dom, días fuera de mes oscurecidos). Semántica de color INVARIABLE: **entradas = verde, salidas = naranja, estancia = azul, desocupado = neutro**. Filtros por inmueble y por tipo. Click en día → panel/dialog con detalles de la reserva (huésped, edades, peticiones especiales, limpieza asociada)
4. **Reservas**: lista/tabla con huésped, inmueble, check-in/out, nº huéspedes, estado, importe; detalle expandible con peticiones especiales
5. **Tedee (cerraduras)**: registro de accesos (quién, cuándo, tipo entrada/salida, inmueble), estado de batería de cerraduras, estado online/offline
6. **Limpieza**: tareas generadas al detectar salida; asignación de hasta 2 personas (maestro con nombre, móvil, coste/hora); estados; checks de limpieza con posibilidad de subir fotos; confirmación final con horas reales + gastos materiales; **cálculo automático de coste (horas × €/hora + materiales)**
7. **Mantenimiento**: tarjetas de tarea con estados Nueva → Asignada → Finalizada; etiquetas de categoría y de gasto (ej. "pilas"); check "urgente" (ir antes de la próxima desocupación); vista por inmueble con primera fecha de desocupación; notas y fecha prevista en días no ocupados; gesto de "deslizar para finalizar" (mock)
8. **Rentabilidad**: ingresos Airbnb sincronizados; alta de gasto (inmueble + tipo: agua, luz, internet, administración, extras); gráfico de barras ingresos vs gastos por mes + quesito por tipo de gasto; comparativa con período anterior (subida/bajada con % y flecha); desglose completo por inmueble; filtro general/por inmueble
9. **Maestros/Ajustes**: inmuebles (vista solo lectura + botón tuerca edición), personas de limpieza/mantenimiento, tipos de gasto configurables (internet fijo mensual recurrente)

## Tarjetas de inmueble (patrón clave)
[Foto] [Nombre/Dirección] + 4 botones de acción: Calendario, Reservas, Limpieza, Rentabilidad → cada uno navega a la vista filtrada por ese inmueble.

## Datos mock (dominio)
- 5 inmuebles con nombre, dirección, dormitorios, m², foto
- Reservas cubriendo mes actual ± 1 mes (algunas con peticiones especiales: cuna, late check-out, mascota…)
- ~15 accesos Tedee recientes
- 6-8 tareas de limpieza (algunas completadas con horas/materiales/checks)
- 8-10 tareas de mantenimiento variadas (cambiar pila cerradura, bombilla, persiana…), con etiquetas y alguna urgente
- 3-4 personas (limpieza/mantenimiento) con coste/hora
- Gastos de 6 meses para gráficos (agua, luz, internet recurrente, administración, extras)

## Sistema de diseño (OBLIGATORIO — skill del usuario "webapp-stack")
- **Tipografía**: Space Grotesk (500–700) para cifras KPI y titulares; Inter (400–600) para UI. `font-feature-settings: "tnum"` en cifras. Unidad al 60% del tamaño de su cifra, color text-faint.
- **Tokens CSS claro/oscuro** (tema con toggle, default claro):
  - Claro: --bg #F4F6FA, --surface #FFFFFF, --surface-2 #EEF1F6, --border #E3E8F0, --text #0C1425, --text-muted #5B6B84, --text-faint #94A3B8
  - Oscuro: --bg #080D1A, --surface #101828, --surface-2 #182338, --border #1E2B42, --text #E9EEF7, --text-muted #93A1B8, --text-faint #5C6B85
- **Semántica de color invariable** en toda la app: entradas=emerald, salidas=orange/amber, estancia=blue, desocupado=neutro slate; limpieza=violet; mantenimiento=rose; ingresos=emerald, gastos=rose.
- **Layout app-like**: ≥lg sidebar 232px (colapsable a riel 72px) + contenido max-w-[1440px]; <lg header 56px + bottom-nav fija 64px con safe-area-inset-bottom y contenido pb-24. Totalmente responsive (es PWA móvil primero).
- **Tarjetas**: 16px radius, identidad visual fuerte, mucho color semántico. KPIs en carrusel scroll-snap en móvil (~42% ancho cada tarjeta).
- **PWA**: manifest.webmanifest (display standalone), theme-color dinámico claro/oscuro (#F4F6FA / #080D1A), icono. Sensación de app nativa instalable.
- **Movimiento**: entrada de vista stagger 70ms, opacity + y 24px, easeOutQuart 500ms; count-up en cifras KPI; transiciones de ruta fade + y 8px (250ms); máx ~10 animados por viewport; respetar prefers-reduced-motion.
- Gráficos con **recharts** (barras, quesito).
