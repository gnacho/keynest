// Utilidad determinista: deriva país + bandera (emoji) de la ubicación del
// huésped que devuelve la API de Airbnb (guest_user.location), p.ej.
// "Vilnius, Lithuania", "Paris, Île-de-France, France" o el código "FR".
// Sin llamadas externas: emparejamiento contra la tabla ISO 3166 local.

import { COUNTRY_NAMES } from './countries';

/** Alias frecuentes que la API usa y que no casan literal con el nombre ISO. */
const ALIASES: Record<string, string> = {
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  uk: 'GB',
  'united kingdom': 'GB',
  'great britain': 'GB',
  england: 'GB',
  uae: 'AE',
  'south korea': 'KR',
  'north korea': 'KP',
  holland: 'NL',
  macau: 'MO',
  'ivory coast': 'CI',
  'cabo verde': 'CV',
};

function normaliza(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .trim();
}

// Mapa nombre-normalizado -> código, construido una vez.
const NOMBRE_A_CODIGO: Record<string, string> = {};
for (const [codigo, nombre] of Object.entries(COUNTRY_NAMES)) {
  NOMBRE_A_CODIGO[normaliza(nombre)] = codigo;
  // tzdata usa "&" ("Antigua & Barbuda"); Airbnb suele escribir "and".
  NOMBRE_A_CODIGO[normaliza(nombre).replace(/\s+&\s+/g, ' and ')] = codigo;
}
for (const [alias, codigo] of Object.entries(ALIASES)) {
  NOMBRE_A_CODIGO[alias] = codigo;
}

/** "FR" / "us" -> código ISO; null si no parece código. */
function codigoDesdeToken(token: string): string | null {
  const t = token.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) && COUNTRY_NAMES[t] ? t : null;
}

export function banderaDeCodigo(codigo: string): string {
  return [...codigo.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

export interface PaisDetectado {
  codigo: string;
  bandera: string;
  nombre: string;
}

/**
 * Resuelve la ubicación cruda de Airbnb a un país. Estrategia: si el último
 * segmento (tras la última coma) es un código ISO de 2 letras, úsalo; si no,
 * emparéjalo contra el nombre ISO (con/sin "and"/"&"). Si nada casa, null
 * (la UI no muestra bandera). Nunca lanza.
 */
export function paisDesdeUbicacion(ubicacion: string): PaisDetectado | null {
  const cruda = (ubicacion || '').trim();
  if (!cruda) return null;

  const segmentos = cruda.split(',').map((s) => s.trim()).filter(Boolean);
  const ultimo = segmentos[segmentos.length - 1] ?? cruda;

  let codigo = codigoDesdeToken(ultimo) ?? codigoDesdeToken(cruda);
  if (!codigo) {
    codigo = NOMBRE_A_CODIGO[normaliza(ultimo)] ?? null;
  }
  if (!codigo) return null;

  return { codigo, bandera: banderaDeCodigo(codigo), nombre: COUNTRY_NAMES[codigo] };
}
