const fs = require('fs');
const { pinyin } = require('pinyin-pro');

const API_BASE = 'https://360zyzz.com/api.php/provide/vod/';

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

function saveData(catName, allItems) {
  let grouped = {};
  for (let item of allItems) {
    let letter = getLetter(item.name);
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push({ name: item.name });
  }
  const safeCat = catName.replace(/[\/\\?%*:|"<>]/g, '_').trim();
  for (let letter in grouped) {
    if (grouped[letter].length > 0) {
      fs.writeFileSync(`${safeCat}_${letter}.json`, JSON.stringify(grouped[letter]));
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
      console.log(`[HTTP ${res.status}] ${url}`);
      return null;
    }
    return await res.json();
  } catch(e) { 
    console.log(`[Fetch Error] ${e.message}`);
    return null; 
  }
}

async function getCategories() {
  console.log('Getting categories...');
  const url = `${API_BASE}?ac=list`;
  const data = await fetchUrl(url);

  if (data && data.class && Array.isArray(data.class)) {
    const categories = data.class.map(c => ({
      id: c.type_id,
      name: c.type_name
    })).filter(c => c.name && !/福利|伦理|写真/i.test(c.name));

    if (categories.length > 0) {
      console.log(`Found ${categories.length} categories: ${categories.map(c => c.name).join(', ')}`);
      return categories;
    }
  }

  console.log('Fallback to default categories.');
  return [
    { id: 1, name: '电影' },
    { id: 2, name: '电视剧' },
    { id: 4, name: '动漫' }
  ];
}

async function processCategory(cat) {
  console.log(`\n=== Start: ${cat.name} (ID: ${cat.id}) ===`);
  let allItems = [];
  let page = 1;
  let totalPages = 999;

  while (page <= totalPages) {
    await sleep(); 
    
    const pageUrl = `${API_BASE}?ac=videolist&t=${cat.id}&pg=${page}&pagesize=100`;
    const pageData = await fetchUrl(pageUrl);

    if (!pageData || !pageData.list || pageData.list.length === 0) {
      console.log(`End at page ${page} for [${cat.name}].`);
      break;
    }

    if (page === 1 && pageData.total) {
      totalPages = Math.ceil(pageData.total / 100);
      console.log(`[${cat.name}] Total pages: ${totalPages}`);
    }

    const items = pageData.list.map(v => ({ name: v.vod_name })).filter(i => i.name);
    allItems = allItems.concat(items);
    console.log(`✅ [${cat.name}] Page ${page}/${totalPages} | Items: ${items.length}`);

    saveData(cat.name, allItems); 
    page++;
  }
  console.log(`=== Done: ${cat.name} | Total: ${allItems.length} ===\n`);
}

(async () => {
  const files = fs.readdirSync('.');
  for (const f of files) {
    if (f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json') {
      fs.unlinkSync(f);
    }
  }

  const categories = await getCategories();

  for (const cat of categories) {
    await processCategory(cat);
    await sleep(3000, 5000); 
  }
  
  console.log('All done!');
})();
