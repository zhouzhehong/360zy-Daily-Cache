const fs = require('fs');
const { pinyin } = require('pinyin-pro');

const API_BASE = 'https://360zyzz.com/api.php/provide/vod/';
const STATE_FILE = 'sync_state.json';

const sleep = (min = 1500, max = 3500) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
};

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

async function fetchUrl(url) {
  try {
    let res = await fetch(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://360zy.com/'
      } 
    });
    if (!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}

async function getCategories() {
  const data = await fetchUrl(`${API_BASE}?ac=list`);
  if (data && data.class) {
    return data.class.map(c => ({ id: c.type_id, name: c.type_name })).filter(c => c.name && !/福利|伦理/.test(c.name));
  }
  return [{ id: 1, name: '电影' }, { id: 2, name: '电视剧' }, { id: 4, name: '动漫' }];
}

async function processCategory(cat, isFirstRun) {
  console.log(`\n=== Start: ${cat.name} ===`);
  
  let existing = {};
  const files = fs.readdirSync('.').filter(f => f.startsWith(`${cat.name}_`) && f.endsWith('.json'));
  for (const f of files) {
    const letter = f.replace(`${cat.name}_`, '').replace('.json', '');
    try { existing[letter] = JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) { existing[letter] = []; }
  }

  let allItems = [];
  Object.values(existing).forEach(list => allItems = allItems.concat(list));

  if (isFirstRun) {
    console.log(`[Full Scan] Fetching all pages...`);
    let page = 1;
    let totalPages = 999;
    while (page <= totalPages) {
      await sleep();
      const data = await fetchUrl(`${API_BASE}?ac=videolist&t=${cat.id}&pg=${page}&pagesize=100`);
      if (!data || !data.list || data.list.length === 0) break;
      if (page === 1 && data.total) totalPages = Math.ceil(data.total / 100);
      
      for (const v of data.list) {
        if (v.vod_name && !allItems.some(m => m.name === v.vod_name)) {
          allItems.push({ name: v.vod_name });
        }
      }
      console.log(`Page ${page}/${totalPages} done.`);
      if (page * 100 >= (data.total || 0)) break;
      page++;
    }
  } else {
    console.log(`[Incremental] Fetching latest 24h updates...`);
    await sleep();
    const data = await fetchUrl(`${API_BASE}?ac=videolist&t=${cat.id}&h=24&pagesize=100`);
    let added = 0;
    if (data && data.list) {
      for (const v of data.list) {
        if (v.vod_name && !allItems.some(m => m.name === v.vod_name)) {
          allItems.push({ name: v.vod_name });
          added++;
        }
      }
    }
    console.log(`Added ${added} new items.`);
  }

  let grouped = {};
  for (let item of allItems) {
    let letter = getLetter(item.name);
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push({ name: item.name });
  }
  for (let letter in grouped) {
    fs.writeFileSync(`${cat.name}_${letter}.json`, JSON.stringify(grouped[letter]));
  }
}

(async () => {
  let isFirstRun = false;
  if (!fs.existsSync(STATE_FILE)) {
    isFirstRun = true;
    console.log("First run detected. Starting FULL scan.");
  }

  const categories = await getCategories();
  for (const cat of categories) {
    await processCategory(cat, isFirstRun);
    await sleep(2000, 4000); 
  }

  if (isFirstRun) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ status: 'completed' }));
    console.log("Full scan finished. State file created.");
  }
})();
