const fs = require('fs');
const path = require('path');
const { pinyin } = require('pinyin-pro');

const API_BASE = 'https://360zy.com/api.php/provide/vod/';
const STATE_FILE = 'sync_state.json';
const MAX_PAGES = 10000;

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

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://360zy.com/' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(`Fetch failed for ${url}: ${e.message}`);
  }
}

function validateVideoList(data, url) {
  if (!data || typeof data !== 'object') throw new Error(`Invalid response from ${url}`);
  const list = data.list || data.data || [];
  if (!Array.isArray(list)) throw new Error(`List is not an array from ${url}`);
  return list;
}

function normalizeVideo(rawItem) {
  if (!rawItem || !rawItem.vod_name || !rawItem.vod_id) return null;
  const id = String(rawItem.vod_id).trim();
  const name = String(rawItem.vod_name).trim();
  if (!id || !name) return null;
  return { id, name };
}

async function getCategories() {
  const data = await fetchJson(`${API_BASE}?ac=list`);
  if (data && data.class && Array.isArray(data.class)) {
    return data.class.map(c => ({ id: c.type_id, name: c.type_name })).filter(c => c.name && !/福利|伦理/.test(c.name));
  }
  return [{ id: 1, name: '电影' }, { id: 2, name: '连续剧' }, { id: 4, name: '动漫' }];
}

async function fetchCategoryPages(category, options = {}) {
  const { hours = null, pageSize = 100 } = options;
  const result = new Map();
  const stats = {
    category_id: category.id,
    category_name: category.name,
    total: null,
    pagecount: null,
    raw_count: 0,
    normalized_count: 0,
    unique_count: 0,
    successful_pages: 0,
    failed_pages: 0,
    complete: false,
    last_sync: new Date().toISOString()
  };

  let page = 1;
  let expectedPages = null;
  let totalCount = null;

  while (page <= MAX_PAGES) {
    const url = new URL(API_BASE);
    url.searchParams.set('ac', 'videolist');
    url.searchParams.set('t', String(category.id));
    url.searchParams.set('pg', String(page));
    url.searchParams.set('pagesize', String(pageSize));
    if (hours !== null) url.searchParams.set('h', String(hours));

    await sleep();

    let data;
    try {
      data = await fetchJson(url.toString());
    } catch (error) {
      stats.failed_pages++;
      throw new Error(`Category ${category.id} failed at page ${page}: ${error.message}`);
    }

    const list = validateVideoList(data, url.toString());

    if (page === 1) {
      if (data.total !== undefined && data.total !== null) totalCount = Number(data.total);
      if (data.pagecount !== undefined && data.pagecount !== null) expectedPages = Number(data.pagecount);
      stats.total = totalCount;
      stats.pagecount = expectedPages;
    }

    if (list.length === 0) {
      stats.successful_pages++;
      break;
    }

    for (const rawItem of list) {
      stats.raw_count++;
      const item = normalizeVideo(rawItem);
      if (item) {
        stats.normalized_count++;
        result.set(item.id, item);
      }
    }

    stats.successful_pages++;

    if (expectedPages !== null) {
      if (page >= expectedPages) break;
    } else if (totalCount !== null) {
      if (page * pageSize >= totalCount) break;
    } else {
      if (list.length < pageSize) break;
    }

    page++;
  }

  if (page > MAX_PAGES) {
    throw new Error(`Category ${category.id} exceeded MAX_PAGES`);
  }

  if (expectedPages !== null && stats.successful_pages < expectedPages) {
    throw new Error(`Category ${category.id} incomplete: fetched ${stats.successful_pages} pages, expected ${expectedPages}`);
  }

  stats.unique_count = result.size;
  stats.complete = true;

  return { items: result, stats };
}

async function fetchAllCategoryItems(category) {
  const result = await fetchCategoryPages(category);
  return result;
}

async function fetchRecentCategoryItems(category) {
  const result = await fetchCategoryPages(category, { hours: 24 });
  return result;
}

function readExistingCategoryItems(categoryName) {
  const items = new Map();
  const files = fs.readdirSync('.').filter(f => f.startsWith(`${categoryName}_`) && f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(content)) {
        for (const item of content) {
          const normalized = normalizeVideo(item);
          if (normalized) items.set(normalized.id, normalized);
        }
      }
    } catch (e) {}
  }
  return items;
}

function writeCategoryItemsAtomically(categoryName, itemsMap) {
  const grouped = {};
  for (const item of itemsMap.values()) {
    const letter = getLetter(item.name);
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(item);
  }

  const managedFiles = [];
  for (const letter in grouped) {
    const fileName = `${categoryName}_${letter}.json`;
    const tempName = `${fileName}.tmp`;
    fs.writeFileSync(tempName, JSON.stringify(grouped[letter]));
    fs.renameSync(tempName, fileName);
    managedFiles.push(fileName);
  }
  return managedFiles;
}

function removeStaleDataFiles(currentManagedFiles) {
  const allFiles = fs.readdirSync('.');
  const currentSet = new Set(currentManagedFiles);
  for (const file of allFiles) {
    if (file.endsWith('.json') && file !== 'package.json' && file !== 'package-lock.json' && file !== 'sync_state.json' && file !== 'categories.json') {
      if (!currentSet.has(file)) {
        fs.unlinkSync(file);
      }
    }
  }
}

async function main() {
  const isFirstRun = !fs.existsSync(STATE_FILE);
  const isFullSync = isFirstRun || process.env.FULL_SYNC === 'true';

  const categories = await getCategories();
  const statsArray = [];
  const allManagedFiles = [];

  for (const cat of categories) {
    try {
      let existingItems = new Map();
      if (!isFullSync) {
        existingItems = readExistingCategoryItems(cat.name);
      }

      const fetchResult = isFullSync
        ? await fetchAllCategoryItems(cat)
        : await fetchRecentCategoryItems(cat);

      const merged = new Map(existingItems);
      for (const [id, item] of fetchResult.items) {
        merged.set(id, item);
      }

      const managed = writeCategoryItemsAtomically(cat.name, merged);
      allManagedFiles.push(...managed);
      
      fetchResult.stats.unique_count = merged.size;
      statsArray.push(fetchResult.stats);
      
    } catch (e) {
      console.error(`Failed to process category ${cat.name}: ${e.message}`);
      process.exit(1);
    }
  }

  if (isFullSync) {
    removeStaleDataFiles(allManagedFiles);
  }

  const existingCats = [...new Set(allManagedFiles.map(f => f.split('_')[0]))];
  fs.writeFileSync('categories.json', JSON.stringify(existingCats));

  const state = {
    status: 'completed',
    lastSync: new Date().toISOString(),
    syncMode: isFullSync ? 'full' : 'incremental',
    categories: statsArray.map(s => s.category_name),
    managedFiles: allManagedFiles,
    statistics: {
      totalCategories: categories.length,
      completedCategories: statsArray.filter(s => s.complete).length,
      failedCategories: categories.length - statsArray.filter(s => s.complete).length,
      rawCount: statsArray.reduce((acc, s) => acc + s.raw_count, 0),
      normalizedCount: statsArray.reduce((acc, s) => acc + s.normalized_count, 0),
      uniqueCount: statsArray.reduce((acc, s) => acc + s.unique_count, 0),
      successfulPages: statsArray.reduce((acc, s) => acc + s.successful_pages, 0),
      failedPages: statsArray.reduce((acc, s) => acc + s.failed_pages, 0)
    }
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('Sync completed successfully.');
}

main().catch(e => {
  console.error('Fatal sync error:', e);
  process.exit(1);
});
