# ⚔️ Tibia Market — Backend

## Deploy en Railway

1. Sube estos archivos a GitHub
2. Conecta Railway con el repo
3. Agrega PostgreSQL en Railway
4. Variables de entorno:
   - `DATABASE_URL` → la de Railway PostgreSQL
   - `JWT_SECRET` → cualquier texto largo secreto
   - `FRONTEND_URL` → tu URL de Netlify
   - `NODE_ENV` → production
5. En Railway → PostgreSQL → Query → pega el contenido de schema.sql

## Archivos
- `index.js` — servidor principal
- `auth.js` — login y registro
- `characters.js` — personajes secundarios
- `listings.js` — mercado de items
- `tc.js` — mercado de Tibia Coins
- `messages.js` — chat
- `db.js` — conexión PostgreSQL
- `middleware.js` — autenticación JWT
- `tibiadata.js` — verificación de personajes
- `schema.sql` — tablas de la base de datos
