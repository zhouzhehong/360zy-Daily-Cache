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
    let res = await fetch(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://360zy.com/'
      } 
    });
    if (!res.ok) {
      console.log(`[HTTP error] status: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch(e) { 
    console.log(`[Fetch error] ${e.message}`);
    return null; 
  }
}

async function processCategory(tid, cat) {
  console.log(`\n--- Starting category: ${cat} ---`);
  let existing = loadExisting(cat);
  
  console.log(`[Sleep 3s] Fetching latest 24h for ${cat}...`);
  await new Promise(r => setTimeout(r, 3000)); // 第一次请求前也等3秒
  
  // pagesize 改成 100，更像真人浏览
  let data = await fetchUrl(`https://360zyzz.com/api.php/provide/vod/?ac=videolist&t=${tid}&h=24&pagesize=100`);
  
  if (data && data.list) {
    console.log(`Found ${data.list.length} latest items.`);
    for (let v of data.list) {
      let name = v.vod_name;
      if (!name) continue;
      let letter = getLetter(name);
      if (!existing[letter]) existing[letter] = [];
      if (!existing[letter].some(m => m.name === name)) {
        existing[letter].push({ name });
      }
    }
  } else {
    console.log(`Failed to fetch latest for ${cat}.`);
  }

  let page = state[cat];
  console.log(`Fetching historical pages starting at page ${page}...`);
  
  // 每天只往下深挖 5 页，细水长流
  for (let i = 0; i < 5; i++) {
    console.log(`[Sleep 4s] Preparing to fetch page ${page}...`);
    await new Promise(r => setTimeout(r, 4000)); // 每页之间等待 4 秒
    
    let pageData = await fetchUrl(`https://360zyzz.com/api.php/provide/vod/?ac=videolist&t=${tid}&pg=${page}&pagesize=100`);
    if (!pageData || !pageData.list || pageData.list.length === 0) {
      console.log(`No more data at page ${page}. Stopping.`);
      break;
    }
    console.log(`[Success] Page ${page}: fetched ${pageData.list.length} items.`);
    
    for (let v of pageData.list) {
      let name = v.vod_name;
      if (!name) continue;
      let letter = getLetter(name);
      if (!existing[letter]) existing[letter] = [];
      if (!existing[letter].some(m => m.name === name)) {
        existing[letter].push({ name });
      }
    }
    page++;
    if (page * 100 >= (pageData.total || 0)) {
      console.log(`Reached total limit for ${cat}.`);
      break;
    }
  }
  state[cat] = page;
  saveExisting(cat, existing);
  console.log(`--- Finished category: ${cat} ---`);
}

(async () => {
  console.log("Start fetching data like a normal human...");
  await processCategory(1, 'movie');
  await processCategory(2, 'tv');
  await processCategory(4, 'anime');
  fs.writeFileSync('page_state.json', JSON.stringify(state));
  console.log("All done! Enjoy your library.");
})();
