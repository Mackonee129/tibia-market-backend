const router = require('express').Router();
const db     = require('./db');
const tibiaData       = require('./tibiadata');
const { generateToken, requireAuth } = require('./middleware');

// POST /api/auth/verify — verificar personaje con TibiaData
router.post('/verify', async (req, res, next) => {
  try {
    const name = (req.body.characterName || '').trim();
    if (!name) return res.status(400).json({ error: 'Falta characterName' });

    const char = await tibiaData.getCharacter(name);
    if (!char) return res.status(404).json({
      error: 'Personaje no encontrado',
      detail: `"${name}" no existe en Tibia. Verifica el nombre exacto.`
    });

    const { rows } = await db.query(
      'SELECT user_id FROM characters WHERE name_lower=$1', [char.name.toLowerCase()]
    );
    res.json({ character: char, hasAccount: rows.length > 0 });
  } catch (err) { next(err); }
});

// POST /api/auth/register — crear cuenta nueva
router.post('/register', async (req, res, next) => {
  try {
    const name = (req.body.characterName || '').trim();
    if (!name) return res.status(400).json({ error: 'Falta characterName' });

    const char = await tibiaData.getCharacter(name);
    if (!char) return res.status(404).json({ error: 'Personaje no encontrado en Tibia' });

    const dup = await db.query('SELECT id FROM characters WHERE name_lower=$1', [char.name.toLowerCase()]);
    if (dup.rows.length) return res.status(409).json({ error: 'Este personaje ya tiene cuenta' });

    const result = await db.transaction(async (client) => {
      const { rows:[user] } = await client.query('INSERT INTO users DEFAULT VALUES RETURNING id');
      const { rows:[character] } = await client.query(
        `INSERT INTO characters(user_id,name,name_lower,world,vocation,level,guild,is_primary)
         VALUES($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING id,name,world,vocation,level`,
        [user.id, char.name, char.name.toLowerCase(), char.world, char.vocation, char.level, char.guild]
      );
      const { token, tokenHash } = generateToken(user.id, character.id);
      const exp = new Date(Date.now() + 30*24*60*60*1000);
      await client.query(
        'INSERT INTO sessions(user_id,character_id,token_hash,expires_at) VALUES($1,$2,$3,$4)',
        [user.id, character.id, tokenHash, exp]
      );
      return { token, character, userId: user.id };
    });

    res.status(201).json({
      message: '¡Cuenta creada!', token: result.token,
      user: { id: result.userId, character: result.character }
    });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const name = (req.body.characterName || '').trim();
    if (!name) return res.status(400).json({ error: 'Falta characterName' });

    const { rows } = await db.query(
      `SELECT c.id AS cid, c.user_id, c.name, c.world, c.vocation, c.level, u.is_active
       FROM characters c JOIN users u ON u.id=c.user_id WHERE c.name_lower=$1`,
      [name.toLowerCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'No existe cuenta para este personaje. ¿Quieres registrarte?' });
    if (!rows[0].is_active) return res.status(403).json({ error: 'Cuenta suspendida' });

    const char = await tibiaData.getCharacter(name);
    if (!char) return res.status(404).json({ error: 'Personaje no encontrado en Tibia' });

    await db.query('UPDATE characters SET level=$1,guild=$2,last_sync=NOW() WHERE id=$3',
      [char.level, char.guild, rows[0].cid]);

    const { token, tokenHash } = generateToken(rows[0].user_id, rows[0].cid);
    await db.query(
      'INSERT INTO sessions(user_id,character_id,token_hash,expires_at) VALUES($1,$2,$3,$4)',
      [rows[0].user_id, rows[0].cid, tokenHash, new Date(Date.now()+30*24*60*60*1000)]
    );

    res.json({ token, user: { id: rows[0].user_id,
      character: { id:rows[0].cid, name:rows[0].name, world:char.world, vocation:char.vocation, level:char.level }
    }});
  } catch (err) { next(err); }
});

// DELETE /api/auth/logout
router.delete('/logout', requireAuth, async (req, res, next) => {
  try {
    const { tokenHash } = require('jsonwebtoken').decode(req.headers.authorization.split(' ')[1]);
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
    res.json({ message: 'Sesión cerrada' });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id,name,world,vocation,level,guild,is_primary FROM characters WHERE user_id=$1 ORDER BY is_primary DESC',
      [req.user.id]
    );
    res.json({ user: req.user, characters: rows, activeCharacter: req.character });
  } catch (err) { next(err); }
});

module.exports = router;
