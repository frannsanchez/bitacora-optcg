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
// "Monkey.D.Luffy (061) (Parallel)" → "Monkey.D.Luffy"; el "(061)" no es una versión distinta
const cleanName = n => String(n || '').replace(/\s*\([^)]*\)/g, '').trim() || String(n || '');
const isBaseName = n => !/\((?!\d+\))[^)]*\)/.test(String(n || ''));
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
  const meta = new Map(); // número → { score, row } con los datos de la versión más "común"

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
      const score = (isBaseName(p.name) ? 0 : 2) + (g.abbreviation && num.startsWith(String(g.abbreviation).toUpperCase()) ? 0 : 1);
      const prev = meta.get(num);
      if (!prev || score < prev.score || (score === prev.score && !prev.row[9] && ext.Description)) {
        // [nombre, tipo, colores, costo, poder, counter, vida, atributo, subtipos, texto, productId de la imagen]
        meta.set(num, { score, row: [cleanName(p.name), ext.CardType || '', ext.Color || '', int(ext.Cost), int(ext.Power), int(ext.Counterplus), int(ext.Life), ext.Attribute || '', ext.Subtypes || '', cleanText(ext.Description), p.productId] });
      }
      const filas = porProducto.get(p.productId) || [{ subTypeName: 'Normal' }];
      for (const x of filas) {
        cards.push([num, p.name, String(ext.Rarity || ''), g.groupId, p.productId, x.subTypeName || 'Normal', r2(x.marketPrice), r2(x.lowPrice), r2(x.midPrice)]);
        n++;
      }
    }
    if (n) G.push([g.groupId, g.name, g.abbreviation || '']);
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

  const fichas = Object.fromEntries([...meta.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, m]) => [n, m.row]));
  await mkdir(dirname(OUT_CARDS), { recursive: true });
  await writeFile(OUT_CARDS, JSON.stringify({ v: 1, updated: data.updated, cards: fichas }));
  console.log(`Fichas: ${meta.size} cartas distintas → ${OUT_CARDS}`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
