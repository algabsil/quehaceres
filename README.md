# Quehaceres de Casa — instalación

## 1. Crear el backend gratuito (Supabase)

1. Andá a https://supabase.com y creá una cuenta gratis (con email, no hace falta Google).
2. "New project" → ponele un nombre (ej: "quehaceres") → elegí una contraseña de base de datos (guardala, no la vas a necesitar para esto pero por las dudas) → región más cercana → crear.
3. Esperá ~1 minuto a que el proyecto esté listo.
4. En el menú izquierdo: **SQL Editor** → "New query" → pegá esto y ejecutalo (botón Run):

```sql
create table tasks_store (
  id text primary key,
  data jsonb not null default '[]',
  updated_at timestamptz default now()
);

alter table tasks_store enable row level security;

create policy "allow anon read" on tasks_store
  for select using (true);

create policy "allow anon write" on tasks_store
  for insert with check (true);

create policy "allow anon update" on tasks_store
  for update using (true);

insert into tasks_store (id, data) values ('main', '[]');
```

5. En el menú izquierdo: **Project Settings** → **API**.
6. Copiá el **Project URL** (algo como `https://xxxxx.supabase.co`) y la clave **anon public**.
7. Abrí el archivo `config.js` de esta carpeta y pegalos donde dice `PEGAR_ACA_TU_...`.

⚠️ Importante: esa clave "anon" queda visible en el código del sitio (es así como funciona). Con la configuración de arriba, cualquiera que tenga el link de tu sitio podría leer o escribir en esta lista puntual — no hay contraseña ni login. Para una lista de tareas domésticas esto normalmente no es un problema, pero no la uses para nada sensible. Si más adelante querés agregarle un login simple, decime y lo armamos.

## 2. Subirlo a GitHub Pages

1. Creá un repositorio nuevo en GitHub (puede ser privado o público, los dos sirven para Pages).
2. Subí todos los archivos de esta carpeta (`index.html`, `app.js`, `config.js` ya con tus datos pegados, `sw.js`, `manifest.json`, `icon-192.png`, `icon-512.png`).
3. En el repositorio: **Settings → Pages → Source**, elegí la rama `main` y carpeta `/ (root)` → Save.
4. Esperá 1-2 minutos. GitHub te va a dar un link tipo `https://tuusuario.github.io/turepo/`.
5. Ese es el link fijo: compartíselo a tu esposa, y los dos pueden "Agregar a pantalla de inicio" desde el navegador del celular para que quede como un ícono más.

## 3. Cómo funciona offline

- La página y su diseño quedan guardados en el celular (service worker), así que abre instantáneamente incluso sin internet.
- Las tareas se guardan siempre primero en el propio celular (`localStorage`), por eso podés agregar/tildar tareas sin conexión.
- Cuando hay internet, sincroniza automáticamente con Supabase cada 30 segundos y también apenas detecta que volvió la conexión.
- Si los dos editan algo casi al mismo tiempo estando ambos offline, gana la última sincronización que llegue (no hay fusión inteligente de conflictos). Para una lista de tareas de casa esto rara vez es un problema real.

## 4. Alertas

- El botón "Activar" pide permiso de notificaciones del navegador. Avisan cuando una tarea está vencida.
- Limitación real de cualquier sitio web (no exclusiva de este): solo notifica mientras la página esté abierta en alguna pestaña o minimizada; si cerrás del todo el navegador, no llegan avisos. Eso solo lo hacen las apps nativas instaladas desde una tienda de apps.

## 5. Novedades de esta versión

- **Interfaz en francés**: toda la app se tradujo. Los nombres internos de categorías cambiaron (se sacó "Mantenimiento" y se agregó "Maison"), así que si tenías tareas viejas categorizadas como "Mantenimiento", vas a tener que reasignarles categoría a mano.
- **Prioridad** (alta/media/baja) con un punto de color en cada tarea.
- **Subtareas**: botón "➕ Sous-tâche" en cada tarea (usa un cuadro de diálogo simple del navegador para escribir el texto).
- **Fotos adjuntas**: botón "📷 Photo" en cada tarea. Las fotos se comprimen automáticamente antes de guardarse, pero igual ocupan espacio en Supabase (plan gratuito da 500MB, de sobra para uso normal, pero evitá adjuntar decenas de fotos de alta resolución sin necesidad).
- **Historial**: las tareas completadas ya no desaparecen, quedan en la sección plegable "Historique" al final de la lista, con botón para vaciarlo del todo si querés.
- **Recordatorio anticipado configurable**: al crear una tarea con fecha, podés elegir avisar 1 día, 2 días o 1 semana antes del vencimiento (además del aviso de "vencida").
- **Resumen diario y semanal**: si activaste las notificaciones, la app manda un resumen a la mañana (a partir de las 8am, la primera vez que la página esté abierta ese día) con las tareas del día, y un resumen los lunes con lo que viene en la semana.
- **Rotación automática**: al crear una tarea recurrente asignada a Alejo o Najwa (no a "Ensemble"), podés tildar "Alterner" para que cada vez que se complete, la siguiente aparición se le asigne automáticamente a la otra persona.
- **"Aujourd'hui uniquement"**: un interruptor arriba de la lista que filtra para mostrar solo lo que vence hoy (y lo que ya está vencido).
- **Ajout rapide (plantillas)**: chips con tareas típicas para agregarlas con un solo toque.
- **Lista de compras separada**: pestaña "Courses" arriba de todo, con su propia lista simple sin fecha ni categoría.

### Importante sobre Supabase con esta versión

La lista de compras se guarda en una fila nueva de la tabla `tasks_store` (con `id = 'shopping'`). **No necesitás correr ningún SQL adicional** — esa fila se crea sola automáticamente la primera vez que alguien agregue un artículo a la lista de compras.

