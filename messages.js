const router = require('express').Router();
const db     = require('./db');
const { requireAuth } = require('./middleware');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT cv.id, cv.last_message, cv.last_message_at,
              CASE WHEN cv.char_a_id=$1 THEN cv.unread_a ELSE cv.unread_b END AS unread,
              CASE WHEN cv.char_a_id=$1 THEN cb.name  ELSE ca.name  END AS other_name,
              CASE WHEN cv.char_a_id=$1 THEN cb.vocation ELSE ca.vocation END AS other_voc,
              COALESCE(il.item_name,'Tibia Coins') AS listing_name,
              cv.item_listing_id, cv.tc_listing_id
       FROM conversations cv
       JOIN characters ca ON ca.id=cv.char_a_id
       JOIN characters cb ON cb.id=cv.char_b_id
       LEFT JOIN item_listings il ON il.id=cv.item_listing_id
       WHERE cv.char_a_id=$1 OR cv.char_b_id=$1
       ORDER BY cv.last_message_at DESC NULLS LAST`,
      [req.character.id]
    );
    res.json({ conversations: rows });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows:[conv] } = await db.query('SELECT * FROM conversations WHERE id=$1',[req.params.id]);
    if (!conv) return res.status(404).json({ error: 'No encontrada' });
    if (conv.char_a_id!==req.character.id && conv.char_b_id!==req.character.id)
      return res.status(403).json({ error: 'No autorizado' });

    const field = conv.char_a_id===req.character.id ? 'unread_a' : 'unread_b';
    await db.query(`UPDATE conversations SET ${field}=0 WHERE id=$1`,[req.params.id]);
    await db.query('UPDATE messages SET read=TRUE WHERE conversation_id=$1 AND sender_id!=$2',
      [req.params.id,req.character.id]);

    const { rows:messages } = await db.query(
      `SELECT m.*,c.name AS sender_name,(m.sender_id=$2) AS is_mine
       FROM messages m JOIN characters c ON c.id=m.sender_id
       WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 100`,
      [req.params.id,req.character.id]
    );
    res.json({ messages, conversation: conv });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { recipientName, content, itemListingId, tcListingId } = req.body;
    if (!recipientName||!content) return res.status(400).json({ error: 'Faltan campos' });
    if (recipientName.toLowerCase()===req.character.name.toLowerCase())
      return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });

    const { rows:[recipient] } = await db.query(
      'SELECT id FROM characters WHERE name_lower=$1',[recipientName.toLowerCase()]
    );
    if (!recipient) return res.status(404).json({ error: 'Destinatario no encontrado' });

    const result = await db.transaction(async (client) => {
      const listingFilter = itemListingId
        ? `AND cv.item_listing_id='${itemListingId}'`
        : tcListingId ? `AND cv.tc_listing_id='${tcListingId}'` : '';

      const { rows:[existing] } = await client.query(
        `SELECT id,char_a_id,char_b_id FROM conversations
         WHERE ((char_a_id=$1 AND char_b_id=$2) OR (char_a_id=$2 AND char_b_id=$1))
         ${listingFilter} LIMIT 1`,
        [req.character.id,recipient.id]
      );

      let cid;
      if (existing) {
        cid = existing.id;
      } else {
        const { rows:[nc] } = await client.query(
          `INSERT INTO conversations(char_a_id,char_b_id,item_listing_id,tc_listing_id)
           VALUES($1,$2,$3,$4) RETURNING id`,
          [req.character.id,recipient.id,itemListingId||null,tcListingId||null]
        );
        cid = nc.id;
      }

      const { rows:[msg] } = await client.query(
        'INSERT INTO messages(conversation_id,sender_id,content) VALUES($1,$2,$3) RETURNING id,content,created_at',
        [cid,req.character.id,content]
      );

      const unread = (existing?.char_a_id===recipient.id) ? 'unread_a' : 'unread_b';
      await client.query(
        `UPDATE conversations SET last_message=$1,last_message_at=NOW(),${unread}=${unread}+1 WHERE id=$2`,
        [content.substring(0,100),cid]
      );
      return { msg, cid };
    });

    res.status(201).json({ message: result.msg, conversationId: result.cid });
  } catch (err) { next(err); }
});

module.exports = router;
