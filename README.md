# Bitácora OPTCG

Una app para jugadores de One Piece Card Game: buscás cartas, armás tus mazos y ves cuánto cuestan, los compartís con tus amigos y, en plena partida, la calculadora te dice si llegás al letal.

Funciona en el celular y en la PC, desde el navegador: **[frannsanchez.github.io/bitacora-optcg](https://frannsanchez.github.io/bitacora-optcg/)**

---

## Qué podés hacer

### Buscar cartas

Un índice con todas las cartas del juego y su imagen.

- Buscás por nombre, número, tripulación o por algo que diga el texto de la carta.
- Filtrás por edición, color, tipo (líder, personaje, evento, escenario) y costo.
- Ves cada versión por separado: la común, las paralelas, las manga, las SP, etc., cada una con su propio precio.
- Al tocar una carta se abre su ficha: la imagen grande, el texto, el poder, el counter, sus versiones y lo que sale cada una. Hay un link a TCGplayer para comprarla.

### Armar mazos y ver cuánto cuestan

- **Creás un mazo de dos formas:** eligiendo las cartas mirando las imágenes (tocás + en cada una) o pegando la lista que te da el simulador o cualquier página de mazos.
- **El precio total aparece bien grande**, y abajo ves cuánto suma cada carta.
- **Elegís la versión de cada carta:** si tenés la paralela o querés comprar la común, la marcás y el precio se ajusta.
- **"Lo que más pesa"** te muestra qué cartas encarecen el mazo, por si buscás reemplazos más baratos.
- **La app te avisa** si el mazo no tiene 50 cartas o si te pasaste de 4 copias de alguna.
- Podés ver las cartas en lista o como grilla de imágenes, ordenarlas de la más cara a la más barata, duplicar un mazo, copiar la lista para pegarla en el simulador o borrarlo (con opción de deshacer).

### Tu usuario

- Creás un usuario con nombre y contraseña. No hace falta mail ni código de nadie.
- Con tu usuario, tus mazos quedan guardados en tu cuenta: los ves en cualquier celular o PC donde entres.
- Si le agregás tu mail, podés entrar con el mail y recuperar la contraseña si te la olvidás.
- Sin usuario la app funciona igual, pero los mazos quedan solo en ese dispositivo.

### Grupos con amigos

- Creás un grupo con un nombre y un código, y les pasás a tus amigos la invitación con un botón.
- Podés estar en varios grupos a la vez (tu grupo de amigos, el del local, etc.).
- **Tus mazos son privados.** En cada mazo elegís en qué grupos mostrarlo, y si lo cambiás, se actualiza ahí también.
- Dentro de un grupo ves a los jugadores y sus mazos, buscás por jugador, mazo o líder y los ordenás por más recientes, mejor valorados o más baratos.
- **Valorás los mazos de los demás** con estrellas de 1 a 5 y un comentario corto, y ves las valoraciones que recibieron los tuyos.
- Podés copiar el mazo de un amigo a tus mazos para probarlo o modificarlo.

### Calculadora de letal

Para cuando no sabés si atacar con todo o esperar un turno.

- Cargás la vida, el poder del líder y la mano del rival, sus blockers y los DON!! que le quedan. También cargás tus atacantes con su poder y los DON!! que tenés libres.
- **Te dice si llegás al letal:** seguro, probable, con riesgo o no.
- **Te arma el plan:** en qué orden atacar y cómo repartir los DON!!.
- **Te muestra qué pasa según lo que tenga en la mano el rival:** mano perfecta, normal o floja.
- **Te dice qué cambiaría el resultado,** por ejemplo un DON!! más o sacar un blocker.
- Si no vas por el letal, te dice a qué personaje del rival conviene pegarle (el que más te amenaza, el que le da cartas o DON!!, el blocker).

### Ajustes

- **Qué precio usar:** la mediana de TCGplayer (la que viene elegida), el Market (lo que se viene pagando) o el Low (la publicación más barata).
- **Qué versión contar por defecto:** la común o la más barata de cada carta.
- **Respaldo:** descargás tus mazos en un archivo y los restaurás en otro dispositivo, aunque no tengas usuario.

### En el celular

- **iPhone:** abrí el link en Safari → **Compartir** → **Agregar a pantalla de inicio**.
- **Android:** abrí el link en Chrome → menú ⋮ → **Agregar a la pantalla principal** (o **Instalar app**).
- Queda como una app más. Después de abrirla una vez con internet, funciona sin conexión con los últimos precios que guardó.
- Cuando hay una versión nueva, se actualiza sola.

### De dónde salen los precios

Son los de **TCGplayer**, en dólares y sin envío. Se actualizan solos todas las noches. La app es de fans y no tiene relación con Bandai ni con TCGplayer.

---

## Información técnica

Esta sección es para consultar cuando haya que hacerle cambios a la app.

### Cómo está armada

HTML, CSS y JavaScript sin frameworks ni compilación. GitHub Pages publica la carpeta `site/`.

```
site/                    lo que se publica
  index.html             estructura: barra lateral (PC), pestañas (celular) y una <section> por herramienta
  css/app.css            colores, letra y componentes (tokens en :root)
  js/core.js             App: navegación por #hash, guardado, precios, fichas de cartas, íconos, avisos
  js/mazos.js            Decks (datos, lectura de listas, precio) y las vistas de mazos
  js/cartas.js           CardUI, índice de cartas, ficha y modo armado
  js/letal.js            pantalla de la calculadora
  js/letal-engine.js     motor de cálculo (sin interfaz)
  js/letal-worker.js     corre el motor en segundo plano
  js/ajustes.js          ajustes y respaldo
  js/nube.js             Cloud (Firebase), Stars (valoraciones) y las vistas de grupos y cuenta
  js/firebase-config.js  datos públicos del proyecto de Firebase
  sw.js                  guarda la app para usarla sin conexión
  data/                  prices.json y cards.json (los genera la tarea diaria, no se versionan)
scripts/sync.mjs         baja precios, ediciones y fichas de TCGCSV
firestore.rules          reglas de seguridad de Firebase
.github/workflows/       publicar.yml: la tarea que publica todo
CLAUDE.md                notas detalladas para hacer cambios
```

### Sumar o cambiar una herramienta

- Cada herramienta es un archivo que llama a `App.register({ id, title, short, icon, nav, tab, home, desc, status, init, show })` y tiene su `<section class="view" id="view-ID">` y su `<script>` en `index.html`.
  - `nav` la muestra en la barra lateral, `tab` en las pestañas del celular (máximo 5) y `home` como tarjeta en Inicio.
- Si sumás archivos, agregalos a la lista `CORE` de `sw.js` para que funcionen sin conexión.
- **En cada cambio subí la versión:** `CACHE = 'bitacora-vN'` en `sw.js` y `VERSION = N` en `core.js`, con el mismo número. Así la app detecta la versión nueva y se recarga sola. El número aparece en Ajustes.
- Probá la sintaxis de cada JS que toques con `node --check archivo.js`.
- **Estilo:** al estilo Material, con superficies tonales en los azules del dorso de las cartas y el dorado para la acción principal y los precios. Usa una sola letra (Manrope), sin mayúsculas sostenidas, con radios de 28, 16, 12 y 8 px.
- Todo el texto de la interfaz va en español rioplatense (voseo).

### Precios y cartas

- La tarea `.github/workflows/publicar.yml` corre en cada push a `main`, todos los días a las 03:23 UTC (00:23 en Argentina) y a mano desde **Actions → Publicar app y precios → Run workflow**.
- `scripts/sync.mjs` baja de [TCGCSV](https://tcgcsv.com) (espejo diario de TCGplayer, categoría One Piece) los precios Market, Low y Mid de cada producto, las ediciones con su fecha y la ficha de cada carta. Mid es la "Listed Median" de TCGplayer.
- La versión "común" de cada número es la que elige `sync.mjs`. Los nombres de TCGplayer son irregulares, así que para reconocer las versiones se usan `Prices.isBase` y `Prices.variant`.
- **Si los precios dejan de actualizarse:** GitHub pausa las tareas programadas después de 60 días sin cambios en el repositorio y avisa por mail. Se reactiva en **Actions**, eligiendo la tarea y tocando **Enable workflow**.

### Usuarios y grupos (Firebase)

Usa Firebase Authentication (mail y contraseña) y Firestore. El SDK se carga solo cuando hace falta.

| Dónde | Qué guarda |
|---|---|
| `usernames/<usuario>` | `{ uid }`: reserva el nombre para una sola cuenta |
| `users/<uid>` | `{ username, groups[], creado }`: solo lo lee su dueño |
| `decks/<id>` | el mazo, privado; `groups` dice dónde está compartido |
| `groups/<gid>` | `{ name, owner, code, created }` |
| `codes/<código>` | `{ group }`: el id es el código, solo lo encuentra quien lo sabe |
| `groups/<gid>/members/<uid>` | `{ username, joined, via }` |
| `groups/<gid>/decks/<id>` | copia del mazo compartido, que la app mantiene al día y borra al dejar de compartirlo |
| `groups/<gid>/ratings/<mazo>_<uid>` | `{ deck, uid, stars (1-5), text (≤280), updated }`: nadie valora sus propios mazos |

- **Cuentas:** se crean como `usuario@bitacora.invalid`. Si el jugador agrega su mail, se confirma con un link (`verifyBeforeUpdateEmail`) y desde ahí la cuenta usa ese mail para entrar y para recuperar la contraseña (`sendPasswordResetEmail`). El mail no se guarda en Firestore y nadie más lo ve.
- **Reglas:** `firestore.rules` se pega en Firebase → Firestore → Reglas → Publicar. Las reglas no tienen ningún código. **Los códigos reales de los grupos van solo en Firebase, nunca en este repositorio, porque es público.**
- `firebase-config.js` es público por diseño: lo que protege los datos son las reglas.
- **Límite gratis de Firestore:** 50.000 lecturas y 20.000 escrituras por día, de sobra para un grupo de amigos.

### Mantenimiento

- **Alguien se olvidó la contraseña y no tiene mail:** en Firebase → Authentication → Usuarios borrás su usuario, y en Firestore el documento `usernames/<su usuario>`, para que lo vuelva a crear con el mismo nombre. Los mazos que había compartido siguen en sus grupos y los puede copiar a la cuenta nueva.
- **Dominio autorizado:** si la app se publica en otra dirección, hay que sumarla en Firebase → Authentication → Configuración → Dominios autorizados.
