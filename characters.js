const router = require('express').Router();
const db     = require('./db');
const tibiaData       = require('./tibiadata');
const { requireAuth } = require('./middleware');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id,name,world,vocation,level,guild,is_primary FROM characters WHERE user_id=$1 ORDER BY is_primary DESC',
      [req.user.id]
    );
    res.json({ characters: rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.characterName || '').trim();
    if (!name) return res.status(400).json({ error: 'Falta characterName' });

    const { rows:[cnt] } = await db.query('SELECT COUNT(*) AS c FROM characters WHERE user_id=$1',[req.user.id]);
    if (parseInt(cnt.c) >= 10) return res.status(400).json({ error: 'Límite de 10 personajes por cuenta' });

    const char = await tibiaData.getCharacter(name);
    if (!char) return res.status(404).json({ error: 'Personaje no encontrado en Tibia' });

    const dup = await db.query('SELECT user_id FROM characters WHERE name_lower=$1',[char.name.toLowerCase()]);
    if (dup.rows.length) {
      return res.status(409).json({
        error: dup.rows[0].user_id === req.user.id ? 'Este personaje ya está en tu cuenta' : 'Este personaje pertenece a otra cuenta'
      });
    }

    const { rows:[c] } = await db.query(
      `INSERT INTO characters(user_id,name,name_lower,world,vocation,level,guild,is_primary)
       VALUES($1,$2,$3,$4,$5,$6,$7,FALSE) RETURNING id,name,world,vocation,level,guild,is_primary`,
      [req.user.id,char.name,char.name.toLowerCase(),char.world,char.vocation,char.level,char.guild]
    );
    res.status(201).json({ message: `Personaje "${char.name}" agregado`, character: c });
  } catch (err) { next(err); }
});

router.patch('/:id/primary', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT id FROM characters WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    await db.query('UPDATE characters SET is_primary=FALSE WHERE user_id=$1',[req.user.id]);
    await db.query('UPDATE characters SET is_primary=TRUE  WHERE id=$1',[req.params.id]);
    res.json({ message: 'Personaje principal actualizado' });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT is_primary FROM characters WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    if (rows[0].is_primary) return res.status(400).json({ error: 'No puedes eliminar tu personaje principal' });
    await db.query('DELETE FROM characters WHERE id=$1',[req.params.id]);
    res.json({ message: 'Personaje eliminado' });
  } catch (err) { next(err); }
});

module.exports = router;
