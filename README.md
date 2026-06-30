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
