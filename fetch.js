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
  if (/[a-zA-Z]/.test(firstChar)) {
    return firstChar.toUpperCase();
  }
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
  } catch(e) { 
    return null; 
  }
}

async function getCategories() {
  const data = await fetchUrl(`${API_BASE}?ac=list`);
  if (data && data.class) {
    return data.class.map(c => ({ id: c.type_id, name: c.type_name })).filter(c => c.name && !/福利|伦理/.test(c.name));
  }
  return [{ id: 1, name: '电影' }, { id: 2, name: '连续剧' }, { id: 4, name: '动漫' }];
}

async function processCategory(cat, isFirstRun) {
  console.log(`\n=== Start: ${cat.name} ===`);
  
  let existing = {};
  const files = fs.readdirSync('.').filter(f => f.startsWith(`${cat.name}_`) && f.endsWith('.json'));
  for (const f of files) {
    const letter = f.replace(`${cat.name}_`, '').replace('.json', '');
    try { existing[letter] = JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) { existing[letter] = []; }
  }

  let idMap = {};
  Object.keys(existing).forEach(letter => {
    existing[letter].forEach(item => {
      idMap[item.id] = { name: item.name, letter: letter };
    });
  });

  let newItemsAdded = 0;
  let namesUpdated = 0;

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
        if (v.vod_name && v.vod_id) {
          const sid = String(v.vod_id);
          const letter = getLetter(v.vod_name);
          if (!idMap[sid]) {
            if (!existing[letter]) existing[letter] = [];
            existing[letter].push({ name: v.vod_name, id: sid });
            idMap[sid] = { name: v.vod_name, letter: letter };
            newItemsAdded++;
          }
        }
      }
      console.log(`Page ${page}/${totalPages} done.`);
      if (page * 100 >= (data.total || 0)) break;
      page++;
    }
  } else {
    console.log(`[Incremental] Checking latest updates...`);
    await sleep();
    const data = await fetchUrl(`${API_BASE}?ac=videolist&t=${cat.id}&h=24&pagesize=100`);
    
    if (data && data.list) {
      for (const v of data.list) {
        if (!v.vod_name || !v.vod_id) continue;
        const sid = String(v.vod_id);
        const newName = v.vod_name;
        const newLetter = getLetter(newName);

        if (!idMap[sid]) {
          if (!existing[newLetter]) existing[newLetter] = [];
          existing[newLetter].push({ name: newName, id: sid });
          idMap[sid] = { name: newName, letter: newLetter };
          newItemsAdded++;
        } else {
          if (idMap[sid].name !== newName) {
            const oldLetter = idMap[sid].letter;
            if (existing[oldLetter]) {
              const idx = existing[oldLetter].findIndex(item => item.id === sid);
              if (idx !== -1) existing[oldLetter].splice(idx, 1);
            }
            if (!existing[newLetter]) existing[newLetter] = [];
            existing[newLetter].push({ name: newName, id: sid });
            idMap[sid] = { name: newName, letter: newLetter };
            namesUpdated++;
          }
        }
      }
    }
    console.log(`Added: ${newItemsAdded}, Updated names: ${namesUpdated}`);
  }

  for (let letter in existing) {
    if (existing[letter].length > 0) {
      fs.writeFileSync(`${cat.name}_${letter}.json`, JSON.stringify(existing[letter]));
    } else {
      if (fs.existsSync(`${cat.name}_${letter}.json`)) {
        fs.unlinkSync(`${cat.name}_${letter}.json`);
      }
    }
  }
}

(async () => {
  let isFirstRun = false;
  if (!fs.existsSync(STATE_FILE)) {
    isFirstRun = true;
    console.log("First run detected. Wiping old data and starting FULL scan...");
    const files = fs.readdirSync('.');
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'package.json' && file !== 'package-lock.json') {
        fs.unlinkSync(file);
      }
    }
  } else {
    console.log("State file found. Starting INCREMENTAL update...");
  }

  const categories = await getCategories();
  for (const cat of categories) {
    await processCategory(cat, isFirstRun);
    await sleep(2000, 4000); 
  }

  if (isFirstRun) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ status: 'completed' }));
    console.log("\nFull scan finished. State file created. Future runs will be incremental.");
  } else {
    console.log("\nIncremental update finished.");
  }
})();
