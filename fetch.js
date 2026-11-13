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
      console.log(`Found ${categories.length} categories.`);
      return categories;
    }
  }

  return [
    { id: 1, name: '电影' },
    { id: 2, name: '电视剧' },
    { id: 4, name: '动漫' }
  ];
}

async function processCategory(cat) {
  console.log(`\n=== Start: ${cat.name} ===`);
  
  let existing = {};
  const files = fs.readdirSync('.');
  for (const f of files) {
    if (f.startsWith(`${cat.name}_`) && f.endsWith('.json')) {
      const letter = f.replace(`${cat.name}_`, '').replace('.json', '');
      try {
        existing[letter] = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch(e) { existing[letter] = []; }
    }
  }

  await sleep();
  const pageUrl = `${API_BASE}?ac=videolist&t=${cat.id}&h=24&pagesize=100`;
  const pageData = await fetchUrl(pageUrl);

  if (!pageData || !pageData.list || pageData.list.length === 0) {
    console.log(`No updates today for [${cat.name}].`);
    return;
  }

  let added = 0;
  for (const v of pageData.list) {
    if (!v.vod_name) continue;
    const letter = getLetter(v.vod_name);
    if (!existing[letter]) existing[letter] = [];
    
    if (!existing[letter].some(m => m.name === v.vod_name)) {
      existing[letter].push({ name: v.vod_name });
      added++;
    }
  }

  for (const letter in existing) {
    fs.writeFileSync(`${cat.name}_${letter}.json`, JSON.stringify(existing[letter]));
  }
  console.log(`✅ Added ${added} new items for [${cat.name}].`);
}

(async () => {
  const categories = await getCategories();
  for (const cat of categories) {
    await processCategory(cat);
    await sleep(1000, 2000); 
  }
  console.log('\nAll done!');
})();
