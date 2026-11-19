// Baja una vez por día los precios de One Piece Card Game desde TCGCSV
// (un espejo gratuito de la API de TCGplayer) y los guarda en site/data/prices.json.
// La app lee ese archivo desde el mismo sitio, así funciona en el celular y sin conexión.
//
// Uso: node scripts/sync.mjs
// Variables opcionales: TCGCSV_BASE (para pruebas), OUT (archivo de salida).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = process.env.TCGCSV_BASE || 'https://tcgcsv.com';
const OUT = process.env.OUT || 'site/data/prices.json';
const OUT_CARDS = process.env.OUT_CARDS || 'site/data/cards.json'; // datos de cada carta (tipo, color, texto...) para el índice
// TCGCSV pide un User-Agent propio y no hacer pedidos demasiado seguidos
const UA = 'bitacora-optcg/1.0 (app personal de precios de mazos; sincroniza 1 vez por dia)';
const PAUSA_MS = 150;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = j => (Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : []);
const r2 = v => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : Math.round(+v * 100) / 100);
const int = v => (v === null || v === undefined || v === '' || Number.isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
// Etiquetas entre paréntesis o corchetes del nombre: "Shanks (004) (Alternate Art)" → ["Alternate Art"].
// El número ("(004)", "(OP09-004)") no cuenta como etiqueta.
const NUMLIKE = /^(\d+|[A-Z]{1,4}\d{0,2}-?\d{2,3}[A-Z]?)$/i;
const tagsOf = n => [...String(n || '').matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map(m => (m[1] ?? m[2]).trim()).filter(t => t && !NUMLIKE.test(t));
// etiquetas que siempre marcan una versión especial (pesan más al elegir la versión común)
const STRONG = /^(reprint|parallel|alternate art|super rare alternate art|manga|sp|full art|tr|gold|silver|wanted poster|box topper|textured foil|jolly roger foil|pirate foil|jumbo)$/i;
// Nombre para mostrar: saca el número y las etiquetas de versión, pero deja las que son parte del nombre
// (por ejemplo "Mr.1 (Daz.Bonez)", que aparece en todas las versiones de esa carta).
const cleanName = (n, keep = new Set()) => String(n || '')
  .replace(/\s*\(([^)]*)\)|\s*\[([^\]]*)\]/g, (m, a) => (a != null && keep.has(a.trim()) ? m : ''))
  .replace(/\s+-\s+[A-Z]{1,4}\d{0,2}-\d{2,3}[A-Z]?\s*$/i, '').trim() || String(n || '');
// ¿La edición (grupo de TCGplayer) es la original de este número? "ST-10" ↔ ST10-006, "OP15-EB04" ↔ EB04-007.
// Los grupos con sufijo ("OP18 RE", "OP09 ANN", "OP08 PRE") son versiones de evento.
function groupScore(abbr, num) {
  const a = String(abbr || '').toUpperCase().trim();
  const toks = a.split(/\s+/)[0].replace(/-(?=\d)/g, '').split('-');
  return (toks.includes(num.split('-')[0]) ? 0 : 2) + (/\s/.test(a) ? 1 : 0);
}
// cuanto más bajo, más "común" es la versión
const versionScore = (name, abbr, num) => tagsOf(name).reduce((s, t) => s + (STRONG.test(t) ? 8 : 4), 0) + groupScore(abbr, num);
const cleanText = t => String(t || '')
  .replace(/<br\s*\/?>\s*/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

async function get(path, as = 'json') {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : 'text/plain' } });
      if (res.ok) return as === 'json' ? res.json() : res.text();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (intento === 3) throw new Error(`${path}: ${err.message}`);
      await sleep(3000 * intento);
    }
  }
}

async function main() {
  let fuenteActualizada = null;
  try { fuenteActualizada = String((await get('/last-updated.txt', 'text')) || '').trim() || null; } catch { /* opcional */ }

  const categorias = results(await get('/tcgplayer/categories'));
  const cat = categorias.find(c => /one\s*piece/i.test(`${c.name} ${c.displayName || ''}`) && !/japan/i.test(`${c.name} ${c.displayName || ''}`));
  if (!cat) throw new Error('No encontré la categoría de One Piece Card Game en TCGCSV');
  console.log(`Categoría: ${cat.name} (${cat.categoryId})`);

  await sleep(PAUSA_MS);
  const grupos = results(await get(`/tcgplayer/${cat.categoryId}/groups`));
  const G = [];
  const cards = [];
  const meta = new Map(); // número → { best: la versión más "común", names: los nombres de todas sus versiones }

  for (const g of grupos) {
    await sleep(PAUSA_MS);
    const productos = results(await get(`/tcgplayer/${cat.categoryId}/${g.groupId}/products`));
    await sleep(PAUSA_MS);
    const precios = results(await get(`/tcgplayer/${cat.categoryId}/${g.groupId}/prices`));
    const porProducto = new Map();
    for (const p of precios) {
      if (!porProducto.has(p.productId)) porProducto.set(p.productId, []);
      porProducto.get(p.productId).push(p);
    }
    let n = 0;
    for (const p of productos) {
      const ext = Object.fromEntries((p.extendedData || []).map(e => [e.name, e.value]));
      const num = String(ext.Number || '').trim().toUpperCase();
      if (!num) continue; // sin número no es una carta (sobres, cajas, etc.)
      const cand = { score: versionScore(p.name, g.abbreviation, num), pid: p.productId, name: p.name, ext };
      let m = meta.get(num);
      if (!m) meta.set(num, (m = { best: null, names: [] }));
      m.names.push(p.name);
      const b = m.best;
      if (!b || cand.score < b.score || (cand.score === b.score && ((!b.ext.Description && ext.Description) || (!!b.ext.Description === !!ext.Description && cand.pid < b.pid)))) m.best = cand;
      const filas = porProducto.get(p.productId) || [{ subTypeName: 'Normal' }];
      for (const x of filas) {
        cards.push([num, p.name, String(ext.Rarity || ''), g.groupId, p.productId, x.subTypeName || 'Normal', r2(x.marketPrice), r2(x.lowPrice), r2(x.midPrice)]);
        n++;
      }
    }
    if (n) G.push([g.groupId, g.name, g.abbreviation || '', String(g.publishedOn || '').slice(0, 10)]);
    console.log(`  ${g.name}: ${n}`);
  }

  // si algo salió mal no pisamos los precios anteriores con un archivo vacío
  if (cards.length < 50) throw new Error(`Solo encontré ${cards.length} cartas: algo cambió en TCGCSV, no guardo nada`);

  await mkdir(dirname(OUT), { recursive: true });
  const data = {
    v: 1,
    updated: new Date().toISOString(),
    source: { name: 'TCGplayer vía TCGCSV', updated: fuenteActualizada, categoryId: cat.categoryId, categoryName: cat.name },
    groups: G,
    cards,
  };
  await writeFile(OUT, JSON.stringify(data));
  console.log(`Listo: ${cards.length} versiones de cartas en ${G.length} ediciones → ${OUT}`);

  const fichas = {};
  for (const [num, m] of [...meta.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // etiquetas que están en todas las versiones = parte del nombre de la carta
    const sets = m.names.map(n => new Set(tagsOf(n)));
    const keep = sets.length > 1 ? new Set([...sets[0]].filter(t => sets.every(s => s.has(t)))) : new Set();
    const x = m.best.ext;
    // [nombre, tipo, colores, costo, poder, counter, vida, atributo, subtipos, texto, productId de la versión común]
    fichas[num] = [cleanName(m.best.name, keep), x.CardType || '', x.Color || '', int(x.Cost), int(x.Power), int(x.Counterplus), int(x.Life), x.Attribute || '', x.Subtypes || '', cleanText(x.Description), m.best.pid];
  }
  await mkdir(dirname(OUT_CARDS), { recursive: true });
  await writeFile(OUT_CARDS, JSON.stringify({ v: 1, updated: data.updated, cards: fichas }));
  console.log(`Fichas: ${meta.size} cartas distintas → ${OUT_CARDS}`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
