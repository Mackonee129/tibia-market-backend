const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('./db');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Token requerido' });

    const token   = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await db.query(
      `SELECT s.user_id, s.character_id,
              c.name AS char_name, c.world, c.vocation, c.level,
              u.reputation, u.total_trades
       FROM sessions s
       JOIN characters c ON c.id = s.character_id
       JOIN users u       ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
      [payload.tokenHash]
    );

    if (!rows.length)
      return res.status(401).json({ error: 'Sesión expirada o inválida' });

    const s = rows[0];
    db.query('UPDATE sessions SET last_used_at=NOW() WHERE token_hash=$1', [payload.tokenHash]).catch(()=>{});

    req.user      = { id: s.user_id, reputation: s.reputation, totalTrades: s.total_trades };
    req.character = { id: s.character_id, name: s.char_name, world: s.world, vocation: s.vocation, level: s.level };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Token inválido o expirado' });
    next(err);
  }
}

function generateToken(userId, characterId) {
  const tokenHash = crypto.randomBytes(32).toString('hex');
  const token     = jwt.sign({ userId, characterId, tokenHash }, process.env.JWT_SECRET, { expiresIn: '30d' });
  return { token, tokenHash };
}

module.exports = { requireAuth, generateToken };
