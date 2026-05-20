const fetch = require('node-fetch');

const BASE  = 'https://api.tibiadata.com/v4';
const cache = new Map();
const TTL   = 5 * 60 * 1000; // 5 minutos

function getCached(k){ const e=cache.get(k); if(!e) return null; if(Date.now()-e.ts>TTL){cache.delete(k);return null;} return e.data; }
function setCache(k,d){ cache.set(k,{data:d,ts:Date.now()}); }

function normalizeVoc(v) {
  const m = {
    'Elite Knight':'Knight','Knight':'Knight',
    'Royal Paladin':'Paladin','Paladin':'Paladin',
    'Elder Druid':'Elder Druid','Druid':'Elder Druid',
    'Master Sorcerer':'Master Sorcerer','Sorcerer':'Master Sorcerer',
    'Monk':'Monk','None':'Sin vocación',
  };
  return m[v] || v;
}

async function getCharacter(name) {
  const key = `char:${name.toLowerCase()}`;
  const hit  = getCached(key);
  if (hit) return hit;

  const res  = await fetch(`${BASE}/character/${encodeURIComponent(name)}`, {
    headers: { 'User-Agent': 'TibiaMarket/1.0' }, timeout: 10000,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TibiaData ${res.status}`);

  const json = await res.json();
  const char = json?.character?.character;
  if (!char?.name) return null;

  const result = {
    name:    char.name,
    world:   char.world,
    vocation:normalizeVoc(char.vocation),
    level:   char.level || 1,
    guild:   char.guild?.name || null,
    online:  char.status === 'online',
  };
  setCache(key, result);
  return result;
}

module.exports = { getCharacter };
