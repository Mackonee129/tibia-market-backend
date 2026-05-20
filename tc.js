const router = require('express').Router();
const db     = require('./db');
const { requireAuth } = require('./middleware');

const FX = { MXN:17.2, USD:1, BRL:5.75 };

router.get('/', async (req, res, next) => {
  try {
    const { server, currency='MXN', page=1, limit=20 } = req.query;
    const where  = ["tl.status='active'","tl.expires_at>NOW()"];
    const params = [];
    if (server) { params.push(server); where.push(`tl.server=$${params.length}`); }
    const rate   = FX[currency]||1;
    const offset = (Math.max(1,+page)-1)*Math.min(50,+limit);
    const take   = Math.min(50,+limit);
    const ws     = where.join(' AND ');

    const [{ rows:listings },{ rows:[{count}] },{ rows:[stats] }] = await Promise.all([
      db.query(`SELECT tl.*,ROUND((tl.price_usd*$${params.length+1})::numeric,4) AS price_local,
                c.name AS seller_name,c.vocation AS seller_voc,c.level AS seller_level,
                u.reputation AS seller_rep,u.total_trades AS seller_trades
                FROM tc_listings tl JOIN characters c ON c.id=tl.character_id JOIN users u ON u.id=c.user_id
                WHERE ${ws} ORDER BY tl.price_usd ASC LIMIT ${take} OFFSET ${offset}`, [...params,rate]),
      db.query(`SELECT COUNT(*) FROM tc_listings tl WHERE ${ws}`, params),
      db.query(`SELECT ROUND(AVG(price_usd)::numeric,5) AS avg, MIN(price_usd) AS min, SUM(amount) AS total
                FROM tc_listings WHERE status='active' AND expires_at>NOW()`),
    ]);

    res.json({ listings, currency, rate,
      stats:{ avgUSD:+stats.avg||0, minUSD:+stats.min||0, totalTCs:+stats.total||0 },
      total:+count, page:+page });
  } catch (err) { next(err); }
});

router.get('/my/active', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id,amount,price_usd,currency,price_local,server,negotiable,views,status,expires_at
       FROM tc_listings WHERE character_id=$1 ORDER BY created_at DESC`, [req.character.id]
    );
    res.json({ listings: rows });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { amount,priceLocal,currency='MXN',server,minBuy=1,negotiable=false,notes } = req.body;
    if (!amount||!priceLocal||!server) return res.status(400).json({ error: 'Faltan campos' });
    if (!['MXN','USD','BRL'].includes(currency)) return res.status(400).json({ error: 'Moneda inválida' });

    const { rows:[{count}] } = await db.query(
      "SELECT COUNT(*) AS count FROM tc_listings WHERE character_id=$1 AND status='active'", [req.character.id]
    );
    if (+count >= 5) return res.status(400).json({ error: 'Límite de 5 ofertas activas de TC' });

    const priceUSD = parseFloat(priceLocal)/(FX[currency]||1);
    const { rows:[l] } = await db.query(
      `INSERT INTO tc_listings(character_id,amount,price_usd,currency,price_local,min_buy,server,negotiable,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,amount,price_usd,currency,server`,
      [req.character.id,+amount,priceUSD,currency,+priceLocal,+minBuy,server,negotiable,notes||null]
    );
    res.status(201).json({ message: '¡Oferta de TC publicada!', listing: l });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      "UPDATE tc_listings SET status='deleted',updated_at=NOW() WHERE id=$1 AND character_id=$2",
      [req.params.id,req.character.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'No encontrado o no autorizado' });
    res.json({ message: 'Eliminado' });
  } catch (err) { next(err); }
});

module.exports = router;
