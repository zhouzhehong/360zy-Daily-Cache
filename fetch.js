const fs = require('fs');
const { pinyin } = require('pinyin-pro');

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

function saveData(cat, allItems) {
  let grouped = {};
  for (let item of allItems) {
    let letter = getLetter(item.name);
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(item);
  }
  for (let letter in grouped) {
    if (grouped[letter].length > 0) {
      fs.writeFileSync(`${cat}_${letter}.json`, JSON.stringify(grouped[letter]));
    }
  }
}

async function fetchUrl(url) {
  try {
    let res = await fetch(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://360zy.com/'
      } 
    });
    if (!res.ok) {
      console.log(`[HTTP error] ${res.status}`);
      return null;
    }
    return await res.json();
  } catch(e) { 
    console.log(`[Fetch error] ${e.message}`);
    return null; 
  }
}

async function processCategory(tid, cat) {
  console.log(`\n=== Start: ${cat} ===`);
  await sleep(2000, 4000);
  let data = await fetchUrl(`https://360zyzz.com/api.php/provide/vod/?ac=videolist&t=${tid}&h=24&pagesize=100`);
  
  let allItems = [];
  if (data && data.list) {
    allItems = allItems.concat(data.list.map(v => ({ name: v.vod_name })).filter(i => i.name));
    console.log(`Latest: ${allItems.length}`);
  }

  let page = 1;
  let totalPages = 999;

  while (page <= totalPages) {
    await sleep(); 
    let pageUrl = `https://360zyzz.com/api.php/provide/vod/?ac=videolist&t=${tid}&pg=${page}&pagesize=100`;
    let pageData = await fetchUrl(pageUrl);

    if (!pageData || !pageData.list || pageData.list.length === 0) {
      console.log(`End at page ${page}`);
      break;
    }

    if (page === 1 && pageData.total) {
      totalPages = Math.ceil(pageData.total / 100);
      console.log(`Total pages: ${totalPages}`);
    }

    let items = pageData.list.map(v => ({ name: v.vod_name })).filter(i => i.name);
    allItems = allItems.concat(items);
    console.log(`✅ Page ${page}/${totalPages} | Items: ${items.length}`);

    saveData(cat, allItems);
    page++;
  }
  console.log(`=== Done: ${cat} | Total: ${allItems.length} ===\n`);
}

(async () => {
  let files = fs.readdirSync('.');
  for (let f of files) {
    if ((f.startsWith('movie_') || f.startsWith('tv_') || f.startsWith('anime_')) && f.endsWith('.json')) {
      fs.unlinkSync(f);
    }
  }
  if (fs.existsSync('page_state.json')) fs.unlinkSync('page_state.json');

  await processCategory(1, 'movie');
  await sleep(3000, 5000); 
  await processCategory(2, 'tv');
  await sleep(3000, 5000);
  await processCategory(4, 'anime');
})();
