# Bitácora OPTCG

App web (PWA) para el celular y la PC: precios de mazos de One Piece Card Game con datos de TCGplayer, buscador de cartas, calculadora de letal, usuarios y grupo de amigos. Todo el texto de la interfaz está en español rioplatense (voseo).

## Cómo está armada

- `site/` es lo que se publica en GitHub Pages. HTML, CSS y JS sin frameworks ni build.
- `site/js/core.js` define `App`: registro de herramientas (`App.register`), navegación por `#hash` (con alias, por ejemplo `#buscar` → `#cartas`), guardado en `localStorage`, precios (`App.Prices`), fichas de cartas (`App.Cards`, se cargan cuando hacen falta), imágenes (`App.imgUrl(productId, 200|400)` del CDN de TCGplayer) y avisos (`App.toast`).
- Cada herramienta es un archivo en `site/js/` que llama a `App.register({ id, title, short, icon, nav, tab, home, desc, status, init, show })` y tiene su `<section class="view" id="view-ID">` en `site/index.html`. `tab: true` la pone en las pestañas del celular (máximo 5).
- `site/js/mazos.js`: `Decks` (datos, parser de listas, precio) y las vistas `mazos` y `mazo` (`#mazo/nube:<id>` muestra un mazo del grupo en solo lectura).
- `site/js/cartas.js`: `CardUI` (imágenes, colores, `versions()` con un ítem por producto de TCGplayer, `sets()` con las ediciones ordenadas, `changeQty(mazo, número, ±1, versión)` que respeta máximo 4 copias y un solo líder y, al sumar, deja como versión del mazo la que tocaste) y las vistas `cartas` (índice con todas las versiones, filtros por edición/versión/tipo/costo/color; `#cartas/mazo:<id>` es el modo armado) y `carta` (ficha; `#carta/<número>~<productId>@<idMazo>`, las dos últimas partes son opcionales).
- Versiones: la común de cada número es la que eligió `scripts/sync.mjs` (`Cards.get(num).pid`). Los nombres de TCGplayer son irregulares ("Shanks (004) (Alternate Art)", "Trafalgar Law - OP09-069 (Reprint)", "Mr.1(Daz.Bonez)"): usá `Prices.isBase` y `Prices.variant` (etiqueta en español, '' para la común), no expresiones propias.
- Precios: por defecto la mediana (`mid` de TCGCSV = "Listed Median" de TCGplayer). `App.PRICE_ORDER` es el orden de respaldo.
- `site/js/nube.js`: `Cloud` (Firebase Auth + Firestore por import dinámico del SDK) y las vistas `grupo` y `cuenta`. Los usuarios se guardan como `usuario@bitacora.invalid`.
- `site/js/letal-engine.js` es el motor puro de la calculadora; corre en `letal-worker.js`.
- `site/sw.js` cachea la app para uso sin conexión. Si agregás archivos, sumalos a `CORE` y subí el número de `CACHE`.
- `scripts/sync.mjs` baja de TCGCSV (espejo de TCGplayer, categoría One Piece) los precios (Market, Low y Mid = mediana) y las ediciones con su fecha a `site/data/prices.json` y las fichas de cada carta (tipo, color, costo, poder, counter, vida, atributo, subtipos, texto e imagen) a `site/data/cards.json`. Esos archivos no se versionan: los genera el workflow.
- `.github/workflows/publicar.yml` publica en Pages en cada push a `main`, todos los días a las 03:23 UTC y a mano.
- `firestore.rules` son las reglas de Firebase. **El código del grupo real va solo en la consola de Firebase, nunca en este repo (es público).**

## Al hacer cambios

- Probá la sintaxis con `node --check` en cada JS que toques.
- El estilo usa los tokens de `:root` en `site/css/app.css` (azules, dorado y blanco del dorso de las cartas).
- La configuración de Firebase (`site/js/firebase-config.js`) es pública por diseño; lo que protege los datos son las reglas.
