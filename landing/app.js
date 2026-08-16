/* Keynest landing — app.js: i18n, tema, slider, comparativa, copiar */

const SHOTS = [
  { id: 'dashboard', alt: 'shots.altDashboard' },
  { id: 'calendario', alt: 'shots.altCalendario' },
  { id: 'reservas', alt: 'shots.altReservas' },
  { id: 'limpieza', alt: 'shots.altLimpieza' },
  { id: 'mantenimiento', alt: 'shots.altMantenimiento' },
  { id: 'rentabilidad', alt: 'shots.altRentabilidad' },
  { id: 'ajustes', alt: 'shots.altAjustes' },
];

/* Matriz comparativa: valores simbólicos + columna propia "keynest" siempre
   a la izquierda. Las filas salen de las fuentes públicas (5-Ago-2026). */
const COMPARE = [
  {
    block: 'compare.b1',
    rows: [
      ['compare.rPrice', '0 €', 'desde 28 €/mes', 'desde ~47 $/mes', 'por listado', 'desde 15,50 €/mes', 'desde 9 $/listado'],
      ['compare.rSelf', '✓', '✗', '✗', '✗', '✗', '✗'],
      ['compare.rOpen', '✓', '✗', '✗', '✗', '✗', '✗'],
      ['compare.rCom', '✓', '◐', '✗', '—', '✗', '—'],
    ],
  },
  {
    block: 'compare.b2',
    rows: [
      ['compare.rIcal', '✓', '✓', '✓', '✓', '✓', '✓'],
      ['compare.rMulti', '✗', '✓', '✓', '✓', '✓', '✓'],
      ['compare.rCal', '✓', '✓', '✓', '✓', '✓', '✓'],
      ['compare.rManual', '✓', '✓', '✓', '✓', '✓', '✓'],
    ],
  },
  {
    block: 'compare.b3',
    rows: [
      ['compare.rClean', '✓', '◐', '◐', '✓', '✓', '✓'],
      ['compare.rToken', '✓', '✗', '✗', '✗', '✗', '◐'],
      ['compare.rPhotos', '✓', '◐', '◐', '◐', '◐', '◐'],
      ['compare.rCost', '✓', '◐', '◐', '◐', '◐', '◐'],
      ['compare.rMaint', '✓', '✗', '◐', '✓', '◐', '✓'],
      ['compare.rLock', '✓', '✗', '◐', '✓', '✗', '✓'],
      ['compare.rPush', '✓', '◐', '◐', '◐', '◐', '◐'],
    ],
  },
  {
    block: 'compare.b4',
    rows: [
      ['compare.rProfit', '✓', '◐', '✓', '✓', '◐', '✓'],
      ['compare.rRecur', '✓', '✗', '◐', '◐', '◐', '◐'],
      ['compare.rPrev', '✓', '◐', '◐', '◐', '◐', '◐'],
      ['compare.rPay', '✗', '✓', '✓', '✓', '✓', '✓'],
    ],
  },
  {
    block: 'compare.b5',
    rows: [
      ['compare.rUsers', '✓', '✗', '◐', '◐', '◐', '◐'],
      ['compare.rLang', '✓', '✗', '✓', '✓', '✓', '✓'],
      ['compare.rDemo', '✓', '✗', '✗', '✗', '✗', '✗'],
      ['compare.rBackup', '✓', '✗', '✗', '✗', '✗', '✗'],
    ],
  },
];

const STATE = {
  lang: 'es',
  theme: 'light',
  shot: 0,
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- i18n ---------- */
function applyLang() {
  const lang = STATE.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    const val = (I18N[lang] && key.split('.').reduce((o, k) => (o ? o[k] : undefined), I18N[lang])) || (I18N.es && key.split('.').reduce((o, k) => (o ? o[k] : undefined), I18N.es)) || el.textContent;
    el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria;
    const val = (I18N[lang] && key.split('.').reduce((o, k) => (o ? o[k] : undefined), I18N[lang])) || '';
    if (val) el.setAttribute('aria-label', val);
  });
  document.documentElement.lang = lang === 'es' ? 'es' : 'en';
  renderShots();
  renderCompare();
  renderStrip();
}

function t(key) {
  return (I18N[STATE.lang] && key.split('.').reduce((o, k) => (o ? o[k] : undefined), I18N[STATE.lang])) || key;
}

/* ---------- Tema ---------- */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', STATE.theme);
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.innerHTML = STATE.theme === 'dark'
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
      : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';
  }
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', STATE.theme === 'dark' ? '#0B1220' : '#ffffff');
  renderShots();
}

/* ---------- Capturas ---------- */
function shotUrl(shot, lang, theme) {
  return `assets/shot-${shot.id}-${lang}-${theme}.webp`;
}

function renderShots() {
  const img = document.getElementById('shotImg');
  const s = SHOTS[STATE.shot];
  img.src = shotUrl(s, STATE.lang, STATE.theme);
  img.alt = t(s.alt);
  const thumbs = document.getElementById('shotThumbs');
  thumbs.innerHTML = '';
  SHOTS.forEach((s2, i) => {
    const btn = document.createElement('button');
    btn.className = 'thumb';
    btn.type = 'button';
    btn.dataset.active = String(i === STATE.shot);
    btn.setAttribute('aria-label', t(s2.alt));
    const im = document.createElement('img');
    im.src = shotUrl(s2, STATE.lang, STATE.theme);
    im.alt = '';
    im.loading = 'lazy';
    btn.appendChild(im);
    btn.addEventListener('click', () => { STATE.shot = i; renderShots(); });
    thumbs.appendChild(btn);
  });
}

/* ---------- Comparativa ---------- */
const COMPETITORS = ['Smoobu', 'Lodgify', 'Hostaway', 'Beds24', 'Guesty'];

function renderCompare() {
  const wrap = document.getElementById('compareTables');
  wrap.innerHTML = '';
  COMPARE.forEach((block) => {
    const div = document.createElement('div');
    div.className = 'compare-table';
    const h3 = document.createElement('h3');
    h3.textContent = t(block.block);
    div.appendChild(h3);
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const thLabel = document.createElement('th');
    thLabel.textContent = t('compare.col');
    headRow.appendChild(thLabel);
    const thOwn = document.createElement('th');
    thOwn.textContent = t('compare.keynest');
    headRow.appendChild(thOwn);
    COMPETITORS.forEach((name) => {
      const th = document.createElement('th');
      th.textContent = name;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    block.rows.forEach((r) => {
      const tr = document.createElement('tr');
      r.forEach((cell, i) => {
        const td = document.createElement(i === 0 ? 'th' : 'td');
        td.setAttribute('scope', i === 0 ? 'row' : 'col');
        if (i === 0) {
          td.textContent = t(cell);
        } else {
          td.className = 'sym';
          td.textContent = cell;
          if (i === 1) td.setAttribute('data-own', 'true');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    div.appendChild(table);
    wrap.appendChild(div);
  });
}

/* ---------- Strip de métricas ---------- */
function renderStrip() {
  const strip = document.getElementById('heroStrip');
  strip.innerHTML = '';
  const items = [
    { n: '5', label: 'strip.props' },
    { n: '13', label: 'strip.res' },
    { n: '∞', label: 'strip.users' },
    { n: '0', label: 'strip.month' },
  ];
  items.forEach((it) => {
    const el = document.createElement('div');
    el.className = 'strip-item';
    const n = document.createElement('span');
    n.className = 'strip-num mono font-display';
    n.textContent = it.n;
    const l = document.createElement('span');
    l.className = 'strip-label';
    l.textContent = t(it.label);
    el.appendChild(n);
    el.appendChild(l);
    strip.appendChild(el);
  });
}

/* ---------- Lightbox (visor ampliado) ---------- */
function openLightbox() {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lbImg');
  const s = SHOTS[STATE.shot];
  img.src = shotUrl(s, STATE.lang, STATE.theme);
  img.alt = t(s.alt);
  lb.hidden = false;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('lbClose').focus();
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  lb.classList.remove('open');
  lb.classList.add('closing');
  document.body.style.overflow = '';
  document.getElementById('shotStage').focus();
  setTimeout(() => {
    lb.hidden = true;
    lb.classList.remove('closing');
  }, reduceMotion ? 0 : 150);
}

function lbNavStep(delta) {
  STATE.shot = (STATE.shot + delta + SHOTS.length) % SHOTS.length;
  const s = SHOTS[STATE.shot];
  const img = document.getElementById('lbImg');
  img.src = shotUrl(s, STATE.lang, STATE.theme);
  img.alt = t(s.alt);
  renderShots();
}

/* ---------- Copiar ---------- */
function copyCommand() {
  const text = t('install.code');
  const fb = document.getElementById('copyFeedback');
  const done = () => {
    fb.textContent = t('install.copied');
    setTimeout(() => { fb.textContent = ''; }, 1600);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* noop */ }
  document.body.removeChild(ta);
  done();
}

/* ---------- Inicialización ---------- */
function init() {
  const savedLang = (() => { try { return localStorage.getItem('keynest-landing-lang'); } catch (e) { return null; } })();
  const navLang = (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  STATE.lang = savedLang === 'en' || savedLang === 'es' ? savedLang : navLang;
  const savedTheme = (() => { try { return localStorage.getItem('keynest-landing-theme'); } catch (e) { return null; } })();
  STATE.theme = savedTheme === 'dark' ? 'dark' : 'light';

  document.getElementById('langSelect').value = STATE.lang;
  document.getElementById('langSelect').addEventListener('change', (e) => {
    STATE.lang = e.target.value;
    try { localStorage.setItem('keynest-landing-lang', STATE.lang); } catch (err) { /* noop */ }
    applyLang();
  });
  document.getElementById('themeBtn').addEventListener('click', () => {
    STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('keynest-landing-theme', STATE.theme); } catch (err) { /* noop */ }
    applyTheme();
  });
  document.getElementById('copyBtn').addEventListener('click', copyCommand);
  document.getElementById('shotPrev').addEventListener('click', () => {
    STATE.shot = (STATE.shot - 1 + SHOTS.length) % SHOTS.length;
    renderShots();
  });
  document.getElementById('shotNext').addEventListener('click', () => {
    STATE.shot = (STATE.shot + 1) % SHOTS.length;
    renderShots();
  });
  document.getElementById('shotStage').addEventListener('click', openLightbox);
  document.getElementById('shotStage').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(); }
  });
  document.getElementById('lbClose').addEventListener('click', closeLightbox);
  document.getElementById('lbPrev').addEventListener('click', () => lbNavStep(-1));
  document.getElementById('lbNext').addEventListener('click', () => lbNavStep(1));
  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    const lb = document.getElementById('lightbox');
    const inLb = !lb.hidden;
    if (e.key === 'Escape' && inLb) { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { if (inLb) lbNavStep(-1); else { STATE.shot = (STATE.shot - 1 + SHOTS.length) % SHOTS.length; renderShots(); } }
    if (e.key === 'ArrowRight') { if (inLb) lbNavStep(1); else { STATE.shot = (STATE.shot + 1) % SHOTS.length; renderShots(); } }
  });

  applyTheme();
  applyLang();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
