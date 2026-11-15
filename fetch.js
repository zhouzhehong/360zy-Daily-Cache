const fs = require('fs');
const { pinyin } = require('pinyin-pro');

const API_BASE = 'https://360zy.com/api.php/provide/vod/';
const STATE_FILE = 'sync_state.json';

const sleep = (min = 1500, max = 3500) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
};

function getLetter(name) {
  if (!name) return 'Other';
  const firstChar = name[0];
  if (/[a-zA-Z]/.test(firstChar)) return firstChar.toUpperCase();
  try {
    const py = pinyin(firstChar, { pattern: 'first', toneType: 'none' });
    return py && /[a-zA-Z]/.test(py[0]) ? py[0].toUpperCase() : 'Other';
  } catch (e) { return 'Other'; }
}

async function fetchUrl(url) {
  try {
    let res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://360zy.com/' } });
    return res.ok ? await res.json() : null;
  } catch(e) { return null; }
}

async function getCategories() {
  const data = await fetchUrl(`${API_BASE}?ac=list`);
  if (data && data.class) {
    return data.class.map(c => ({ id: c.type_id, name: c.type_name })).filter(c => c.name && !/福利|伦理/.test(c.name));
  }
  return [{ id: 1, name: '电影' }, { id: 2, name: '连续剧' }, { id: 4, name: '动漫' }];
}

function cleanDatabase() {
  const files = fs.readdirSync('.');
  for (const file of files) {
    if (file.endsWith('.json') && file !== 'package.json' && file !== 'package-lock.json' && file !== 'sync_state.json' && file !== 'categories.json') {
      try {
        const content = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(content)) {
          const validItems = content.filter(item => item && item.id && String(item.id).trim() !== "");
          if (validItems.length === 0) {
            fs.unlinkSync(file);
          } else if (validItems.length < content.length) {
            fs.writeFileSync(file, JSON.stringify(validItems));
          }
        }
      } catch (e) {}
    }
  }
}

async function processCategory(cat, isFirstRun) {
  let existing = {};
  const files = fs.readdirSync('.').filter(f => f.startsWith(`${cat.name}_`) && f.endsWith('.json'));
  for (const f of files) {
    const letter = f.replace(`${cat.name}_`, '').replace('.json', '');
    try { existing[letter] = JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) { existing[letter] = []; }
  }

  let idMap = new Set();
  let allItems = [];
  Object.keys(existing).forEach(letter => {
    existing[letter].forEach(item => {
      idMap.add(String(item.id));
      allItems.push({ name: item.name, id: item.id });
    });
  });

  if (isFirstRun) {
    let page = 1;
    let totalPages = 999;
    while (page <= totalPages) {
      await sleep();
      const data = await fetchUrl(`${API_BASE}?ac=videolist&t=${cat.id}&pg=${page}&pagesize=100`);
      if (!data || !data.list || data.list.length === 0) break;
      if (page === 1 && data.total) totalPages = Math.ceil(data.total / 100);
      
      for (const v of data.list) {
        if (v.vod_name && v.vod_id && !idMap.has(String(v.vod_id))) {
          allItems.push({ name: v.vod_name, id: String(v.vod_id) });
          idMap.add(String(v.vod_id));
        }
      }
      if (page * 100 >= (data.total || 0)) break;
      page++;
    }
  } else {
    await sleep();
    const data = await fetchUrl(`${API_BASE}?ac=videolist&t=${cat.id}&h=24&pagesize=100`);
    if (data && data.list) {
      for (const v of data.list) {
        if (!v.vod_name || !v.vod_id) continue;
        const sid = String(v.vod_id);
        if (!idMap.has(sid)) {
          allItems.push({ name: v.vod_name, id: sid });
          idMap.add(sid);
        }
      }
    }
  }

  if (allItems.length > 0) {
    let grouped = {};
    for (let item of allItems) {
      let letter = getLetter(item.name);
      if (!grouped[letter]) grouped[letter] = [];
      grouped[letter].push({ name: item.name, id: item.id });
    }
    for (let letter in grouped) {
      fs.writeFileSync(`${cat.name}_${letter}.json`, JSON.stringify(grouped[letter]));
    }
  }
}

(async () => {
  cleanDatabase();

  let isFirstRun = false;
  if (!fs.existsSync(STATE_FILE)) {
    isFirstRun = true;
  }

  const categories = await getCategories();
  for (const cat of categories) {
    await processCategory(cat, isFirstRun);
    await sleep(2000, 4000); 
  }

  const allFiles = fs.readdirSync('.').filter(f => f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json' && f !== 'sync_state.json' && f !== 'categories.json');
  const existingCats = [...new Set(allFiles.map(f => f.split('_')[0]))];
  fs.writeFileSync('categories.json', JSON.stringify(existingCats));

  if (isFirstRun) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ status: 'completed' }));
  }
})();
