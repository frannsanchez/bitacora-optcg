# Bitácora OPTCG

App para el celular y la PC con:

- **Mazos**: cargás listas y te muestra el precio del mazo completo y de cada carta en TCGplayer.
- **Grupos**: cada amigo tiene su usuario y contraseña (y puede agregar su mail para recuperarla). Cualquiera puede crear grupos con nombre y código de invitación, y estar en varios. Los mazos son privados: cada uno elige en qué grupos compartir cada mazo. Dentro de un grupo se buscan jugadores y mazos, se valoran con estrellas y un comentario, y se copian.
- **Cartas**: índice con la imagen de cada carta, filtros por edición, color, tipo y costo, búsqueda por nombre, tripulación o texto, y la ficha de cada carta con todas sus versiones y precios. Desde un mazo, "Agregar cartas" abre el índice para sumar o sacar copias con + y −.
- **Calculadora de letal**.

Los precios son de TCGplayer, en dólares y sin envío. Llegan a través de [TCGCSV](https://tcgcsv.com), un espejo gratuito de los datos de TCGplayer que se actualiza una vez por día. Una tarea de GitHub los baja todas las noches y los publica junto con la app.

## Cómo publicarla (una sola vez, desde la compu)

1. Creá una cuenta gratis en [github.com](https://github.com).
2. Arriba a la derecha tocá **+** → **New repository**. Nombre: `bitacora-optcg`, dejalo en **Public** y tocá **Create repository**.
3. En el repositorio vacío tocá **uploading an existing file** y arrastrá **todo lo que hay dentro** de esta carpeta: `site`, `scripts`, `.github` y este `README.md`. Después tocá **Commit changes**.
   - En Mac la carpeta `.github` está oculta. En el Finder apretá **Cmd + Shift + .** para verla.
4. Entrá a **Settings** → **Pages**. En **Build and deployment → Source** elegí **GitHub Actions**.
5. Entrá a la pestaña **Actions**, tocá **Publicar app y precios** → **Run workflow** → **Run workflow**. Tarda unos minutos. Si ya había una corrida en rojo de antes del paso 4, ignorala.
6. Cuando termine en verde, el link aparece en **Settings → Pages**. Es algo así: `https://TU-USUARIO.github.io/bitacora-optcg/`

## Usuarios y grupos de amigos (Firebase, una sola vez)

Los usuarios y las listas compartidas se guardan en **Firebase**, un servicio gratis de Google (no pide tarjeta). Sin este paso la app funciona igual, pero cada uno guarda sus mazos solo en su teléfono.

1. Entrá a [console.firebase.google.com](https://console.firebase.google.com) con tu cuenta de Google y tocá **Crear un proyecto**. Nombre: `bitacora-optcg`. Google Analytics no hace falta.
2. En el menú de la izquierda: **Compilación → Authentication → Comenzar**. En **Método de acceso** elegí **Correo electrónico/contraseña**, activalo y guardá. (La app usa usuario y contraseña y arma sola un “correo” interno. Si alguien agrega su mail en **Cuenta**, Firebase le manda un link para confirmarlo y desde ahí puede entrar con el mail y recuperar la contraseña.)
3. **Compilación → Firestore Database → Crear base de datos**. Ubicación: `southamerica-east1 (São Paulo)`. Empezá en **modo de producción**.
4. En Firestore, pestaña **Reglas**: borrá lo que hay, pegá todo el archivo `firestore.rules` de esta carpeta y tocá **Publicar**. Las reglas no llevan ningún código: los códigos de los grupos se guardan en la base.
5. Tocá el engranaje → **Configuración del proyecto** → abajo, en **Tus apps**, el ícono **</>** (web). Ponele `Bitácora` y registrala. Te muestra un bloque `firebaseConfig`.
6. En GitHub abrí `site/js/firebase-config.js`, tocá el lápiz y reemplazá cada `PEGAR_AQUI` por los valores de `apiKey`, `authDomain`, `projectId` y `appId`. Tocá **Commit changes**: la app se vuelve a publicar sola.
7. En Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio** y poné `TU-USUARIO.github.io`.
8. En **Authentication → Plantillas**, tocá el lápiz de **Idioma de la plantilla** y elegí **Español**: así los mails de confirmación y de nueva contraseña llegan en castellano.

Listo: creá tu usuario en **Cuenta**, armá tu grupo en **Grupos → Crear grupo** y pasales a tus amigos la invitación (en la página del grupo está el botón **Copiar invitación**). Cualquiera puede crear su usuario sin código; con el código entra directo a tu grupo.

- **Los códigos** los controla Firebase con las reglas: solo encuentra un grupo quien sabe su código. Alguien que crea un usuario sin código solo ve sus propios mazos hasta que se suma a un grupo.
- **Cada mazo** es privado hasta que su dueño lo comparte en un grupo; ahí lo ven los integrantes de ese grupo, pero solo su dueño lo puede cambiar o dejar de compartir.
- **Los perfiles y los mails** no los ve nadie más: en cada grupo solo aparece el nombre de usuario.
- **Si alguien se olvida la contraseña**: si le agregó un mail a su cuenta, toca **¿Te olvidaste la contraseña?** y le llega un link. Si no tiene mail, no se puede recuperar: desde Firebase → Authentication → Usuarios podés borrar su usuario, y en Firestore el documento `usernames/<su usuario>`, para que lo vuelva a crear con el mismo nombre; los mazos que había compartido quedan en sus grupos y los puede copiar a su cuenta nueva.
- **Nombres de usuario**: cada nombre queda reservado para una sola cuenta (colección `usernames`), aunque esa cuenta después pase a usar su mail.
- **Valoraciones**: son de cada grupo; una por jugador y por mazo, de 1 a 5 estrellas con un comentario corto. Nadie puede valorar sus propios mazos.
- **Límite gratis**: 50.000 lecturas y 20.000 escrituras por día, de sobra para un grupo de amigos.

## Instalarla en el iPhone

1. Abrí el link en Safari → **Compartir** → **Agregar a pantalla de inicio**.
2. Abrila una vez desde el ícono con internet. Desde ahí funciona sin conexión con los últimos precios que guardó.

Para compartirla, pasá el mismo link. Cada persona guarda sus propios mazos en su teléfono.

## Cosas para saber

- **Precios**: se actualizan solos todos los días a las 00:23 (hora de Argentina). También podés correr la tarea a mano desde **Actions**.
- **Si dejan de actualizarse**: GitHub pausa las tareas programadas de un repositorio después de 60 días sin cambios y avisa por mail. Entrá a **Actions**, elegí la tarea y tocá **Enable workflow**.
- **Tus mazos** quedan guardados en el dispositivo y, si entraste con tu usuario, también en tu cuenta: los ves en cualquier celular o PC donde entres. Sin usuario podés pasarlos con **Ajustes → Descargar respaldo** y **Restaurar respaldo**.
- **Actualizar la app**: subí los archivos nuevos al repositorio de la misma forma (paso 3). Se vuelve a publicar sola.

## Cómo está armada (para sumar herramientas)

```
site/                 lo que se publica
  index.html          la estructura: barra lateral, pestañas y una <section> por herramienta
  css/app.css         colores y componentes compartidos
  js/core.js          navegación, guardado, precios y registro de herramientas
  js/mazos.js         mazos y precios
  js/cartas.js        índice de cartas, ficha y armado de mazos
  js/letal*.js        calculadora de letal
  js/ajustes.js       ajustes y respaldo
  js/nube.js          usuarios, grupo y sincronización con Firebase
  js/firebase-config.js  datos de tu proyecto de Firebase
  sw.js               guarda la app para usarla sin conexión
scripts/sync.mjs      baja los precios de TCGCSV a site/data/prices.json
firestore.rules       reglas de seguridad de Firebase (código del grupo y permisos)
.github/workflows/    la tarea diaria que publica todo
```

Cada herramienta se suma con `App.register({ id, title, icon, nav, home, init, show })` en su propio archivo, más su `<section class="view" id="view-ID">` y su `<script>` en `index.html`. Si la herramienta tiene archivos nuevos, agregalos también a la lista `CORE` de `sw.js` para que funcionen sin conexión.

App de fans, sin relación con Bandai ni con TCGplayer.
