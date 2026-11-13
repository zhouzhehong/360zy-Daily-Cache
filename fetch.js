const fs = require('fs');
const { pinyin } = require('pinyin-pro');

function getLetter(name) {
  if (!name) return '0';
  const firstChar = name[0];
  if (/[a-zA-Z0-9]/.test(firstChar)) return firstChar.toUpperCase();
  try {
    const py = pinyin(firstChar, { pattern: 'first', toneType: 'none' });
    return py && /[a-zA-Z]/.test(py[0]) ? py[0].toUpperCase() : 'Other';
  } catch (e) {
    return 'Other';
  }
}

function loadExisting(cat) {
  let files = fs.readdirSync('.').filter(f => f.startsWith(`${cat}_`) && f.endsWith('.json'));
  let existing = {};
  for (let f of files) {
    let letter = f.replace(`${cat}_`, '').replace('.json', '');
    try { existing[letter] = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch(e) { existing[letter] = []; }
  }
  return existing;
}

function saveExisting(cat, existing) {
  for (let letter in existing) {
    if (existing[letter].length > 0) {
      fs.writeFileSync(`${cat}_${letter}.json`, JSON.stringify(existing[letter]));
    }
  }
}

let state = { movie: 1, tv: 1, anime: 1 };
if (fs.existsSync('page_state.json')) {
  state = JSON.parse(fs.readFileSync('page_state.json', 'utf8'));
}

async function fetchUrl(url) {
  try {
    let res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch(e) { return null; }
}

async function processCategory(tid, cat) {
  let existing = loadExisting(cat);
  let data = await fetchUrl(`https://360zyzz.com/api.php/provide/vod/?ac=videolist&t=${tid}&h=24&pagesize=500`);
  if (data && data.list) {
    for (let v of data.list) {
      let name = v.vod_name;
      if (!name) continue;
      let letter = getLetter(name);
      if (!existing[letter]) existing[letter] = [];
      if (!existing[letter].some(m => m.name === name)) {
        existing[letter].push({ name });
      }
    }
  }

  let page = state[cat];
  for (let i = 0; i < 15; i++) {
    data = await fetchUrl(`https://360zyzz.com/api.php/provide/vod/?ac=videolist&t=${tid}&pg=${page}&pagesize=500`);
    if (!data || !data.list || data.list.length === 0) break;
    for (let v of data.list) {
      let name = v.vod_name;
      if (!name) continue;
      let letter = getLetter(name);
      if (!existing[letter]) existing[letter] = [];
      if (!existing[letter].some(m => m.name === name)) {
        existing[letter].push({ name });
      }
    }
    page++;
    if (page * 500 >= (data.total || 0)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  state[cat] = page;
  saveExisting(cat, existing);
}

(async () => {
  await processCategory(1, 'movie');
  await processCategory(2, 'tv');
  await processCategory(4, 'anime');
  fs.writeFileSync('page_state.json', JSON.stringify(state));
})();
