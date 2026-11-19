# Bitácora OPTCG

App web (PWA) para el celular y la PC: precios de mazos de One Piece Card Game con datos de TCGplayer, buscador de cartas, calculadora de letal, usuarios y grupo de amigos. Todo el texto de la interfaz está en español rioplatense (voseo).

## Cómo está armada

- `site/` es lo que se publica en GitHub Pages. HTML, CSS y JS sin frameworks ni build.
- `site/js/core.js` define `App`: registro de herramientas (`App.register`), navegación por `#hash` (con alias, por ejemplo `#buscar` → `#cartas`), guardado en `localStorage`, precios (`App.Prices`), fichas de cartas (`App.Cards`, se cargan cuando hacen falta), imágenes (`App.imgUrl(productId, 200|400)` del CDN de TCGplayer) y avisos (`App.toast`).
- Cada herramienta es un archivo en `site/js/` que llama a `App.register({ id, title, short, icon, nav, tab, home, desc, status, init, show })` y tiene su `<section class="view" id="view-ID">` en `site/index.html`. `tab: true` la pone en las pestañas del celular (máximo 5).
- `site/js/mazos.js`: `Decks` (datos, parser de listas, precio) y las vistas `mazos` y `mazo`. La vista `mazo` tiene encabezado (líder, nombre, chips), el precio destacado, dos acciones principales, un menú ⋮ (`<details class="menu">`, se cierra solo desde `core.js`) y pestañas Cartas / Precio / Compartir (o Valoraciones en el mazo de otro, `#mazo/nube:<gid>:<id>`, solo lectura). Al crear un mazo se elige entre "Con imágenes" (abre el índice en modo armado) y "Pegando una lista".
- `site/js/cartas.js`: `CardUI` (imágenes, colores, `versions()` con un ítem por producto de TCGplayer, `sets()` con las ediciones ordenadas, `changeQty(mazo, número, ±1, versión)` que respeta máximo 4 copias y un solo líder y, al sumar, deja como versión del mazo la que tocaste) y las vistas `cartas` (índice con todas las versiones, filtros por edición/versión/tipo/costo/color; `#cartas/mazo:<id>` es el modo armado) y `carta` (ficha; `#carta/<número>~<productId>@<idMazo>`, las dos últimas partes son opcionales).
- Versiones: la común de cada número es la que eligió `scripts/sync.mjs` (`Cards.get(num).pid`). Los nombres de TCGplayer son irregulares ("Shanks (004) (Alternate Art)", "Trafalgar Law - OP09-069 (Reprint)", "Mr.1(Daz.Bonez)"): usá `Prices.isBase` y `Prices.variant` (etiqueta en español, '' para la común), no expresiones propias.
- Precios: por defecto la mediana (`mid` de TCGCSV = "Listed Median" de TCGplayer). `App.PRICE_ORDER` es el orden de respaldo.
- `site/js/nube.js`: `Cloud` (Firebase Auth + Firestore por import dinámico del SDK), `Stars` (estrellas, la tarjeta "Compartir con tus grupos" y las valoraciones que muestra la vista `mazo`) y las vistas `grupo` (título "Grupos": `#grupo` lista mis grupos, `#grupo/nuevo`, `#grupo/unirme[:código]`, `#grupo/<gid>` y `#grupo/<gid>/<usuario>`) y `cuenta`.
- Grupos: `groups/<gid>` → `{ name, owner, code, created }`, `codes/<código>` → `{ group }` (el id es el código: solo lo encuentra quien lo sabe), `groups/<gid>/members/<uid>` → `{ username, joined, via }`. Mis grupos se guardan en `users/<uid>.groups`. Para crear usuario el código es opcional (si viene, entra a ese grupo). Las reglas no tienen ningún código.
- Mazos: `decks/<id>` es privado (solo su dueño; `groups` dice dónde está compartido). Compartir = copia en `groups/<gid>/decks/<id>`, que `Cloud.sync` mantiene al día y borra al dejar de compartir o borrar el mazo. El mazo de otro se abre en `#mazo/nube:<gid>:<id>`.
- Cuentas: se crean como `usuario@bitacora.invalid`. Si el jugador agrega su mail (`verifyBeforeUpdateEmail`, con link de confirmación), la cuenta pasa a usar ese mail: entra con usuario o mail (cada dispositivo recuerda el mail de cada usuario en `localStorage`) y recupera la contraseña con `sendPasswordResetEmail`. El mail no se guarda en Firestore. Los nombres se reservan en `usernames/<usuario>` → `{ uid }` para que nadie reuse uno liberado.
- Valoraciones: por grupo, `groups/<gid>/ratings/<idMazo>_<uid>` → `{ deck, uid, stars (1-5), text (≤280), updated }`; se cargan con `Cloud.loadGroups`.
- `site/js/letal-engine.js` es el motor puro de la calculadora; corre en `letal-worker.js`.
- `site/sw.js` cachea la app para uso sin conexión. Si agregás archivos, sumalos a `CORE`. En cada cambio subí `CACHE` ('bitacora-vN') y `VERSION` en `core.js` (el mismo N): la app se recarga sola cuando detecta una versión nueva.
- `scripts/sync.mjs` baja de TCGCSV (espejo de TCGplayer, categoría One Piece) los precios (Market, Low y Mid = mediana) y las ediciones con su fecha a `site/data/prices.json` y las fichas de cada carta (tipo, color, costo, poder, counter, vida, atributo, subtipos, texto e imagen) a `site/data/cards.json`. Esos archivos no se versionan: los genera el workflow.
- `.github/workflows/publicar.yml` publica en Pages en cada push a `main`, todos los días a las 03:23 UTC y a mano.
- `firestore.rules` son las reglas de Firebase. **Los códigos reales de los grupos van solo en Firebase, nunca en este repo (es público).**

## Al hacer cambios

- Probá la sintaxis con `node --check` en cada JS que toques.
- El estilo usa los tokens de `:root` en `site/css/app.css` (azules, dorado y blanco del dorso de las cartas), al estilo Material: superficies tonales sin bordes, una sola letra (Manrope), sin mayúsculas sostenidas, botones redondeados (dorado = acción principal, azul = secundaria), radios 28/16/12/8. En el celular el primer `.back` de cada vista se muestra en la barra de arriba.
- La configuración de Firebase (`site/js/firebase-config.js`) es pública por diseño; lo que protege los datos son las reglas.
