const fs = require("fs");
const path = require("path");
const { pinyin } = require("pinyin-pro");

const API_BASE = "https://360zy.com/api.php/provide/vod/";
const STATE_FILE = "sync_state.json";
const CATEGORIES_FILE = "categories.json";
const PAGE_SIZE = 100;
const MAX_PAGES = 10000;
const EXCLUDED_CATEGORY_PATTERN = /福利|伦理/;
const RESERVED_FILES = new Set([
  "package.json",
  "package-lock.json",
  STATE_FILE,
  CATEGORIES_FILE
]);

const sleep = (min = 1500, max = 3500) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
};

function getLetter(name) {
  if (typeof name !== "string" || !name.trim()) return "Other";

  const firstChar = Array.from(name.trim())[0];
  if (/[a-zA-Z]/.test(firstChar)) return firstChar.toUpperCase();

  try {
    const result = pinyin(firstChar, {
      pattern: "first",
      toneType: "none"
    });
    const initial = String(result || "").charAt(0);
    return /^[a-z]$/i.test(initial) ? initial.toUpperCase() : "Other";
  } catch {
    return "Other";
  }
}

function validateCategoryName(name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name !== name.trim() ||
    /[\/\\\x00-\x1F\x7F]/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error(`Invalid category name: ${String(name)}`);
  }

  return name;
}

async function fetchJson(url) {
  let response;

  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://360zy.com/"
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw new Error(`API network request failed: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`API returned HTTP ${response.status}: ${url}`);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(`API returned invalid JSON: ${url}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`API returned an invalid response object: ${url}`);
  }

  return data;
}

async function getCategories() {
  const data = await fetchJson(`${API_BASE}?ac=list`);

  if (!Array.isArray(data.class)) {
    throw new Error("Category API response does not contain a valid class array");
  }

  const categories = [];
  const seen = new Set();

  for (const item of data.class) {
    if (!item || item.type_id === undefined || item.type_id === null) continue;
    if (typeof item.type_name !== "string") continue;

    const name = validateCategoryName(item.type_name);
    if (EXCLUDED_CATEGORY_PATTERN.test(name)) continue;
    if (seen.has(name)) continue;

    seen.add(name);
    categories.push({
      id: String(item.type_id),
      name
    });
  }

  if (categories.length === 0) {
    throw new Error("Category API returned no usable categories");
  }

  return categories;
}

function readJsonFile(fileName, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileName, "utf8"));
  } catch {
    return fallback;
  }
}

function readExistingCategoryItems(categoryName) {
  const prefix = `${categoryName}_`;
  const files = fs.readdirSync(".").filter(file =>
    file.startsWith(prefix) &&
    file.endsWith(".json") &&
    !RESERVED_FILES.has(file)
  );

  const itemsById = new Map();

  for (const file of files) {
    const letter = file.slice(prefix.length, -5);
    if (!/^(?:[A-Z]|Other)$/.test(letter)) continue;

    const content = readJsonFile(file, null);
    if (!Array.isArray(content)) {
      throw new Error(`Existing data file is invalid: ${file}`);
    }

    for (const item of content) {
      if (!item || item.id === undefined || item.id === null || !String(item.id).trim()) continue;
      if (typeof item.name !== "string" || !item.name.trim()) continue;

      itemsById.set(String(item.id), {
        name: item.name,
        id: String(item.id)
      });
    }
  }

  return itemsById;
}

function validateVideoList(data, url) {
  if (!Array.isArray(data.list)) {
    throw new Error(`Video list API returned an invalid list: ${url}`);
  }

  return data.list;
}

function normalizeVideo(item) {
  if (!item || item.vod_id === undefined || item.vod_id === null) return null;
  if (typeof item.vod_name !== "string" || !item.vod_name.trim()) return null;

  const id = String(item.vod_id).trim();
  if (!id) return null;

  return {
    name: item.vod_name.trim(),
    id
  };
}

async function fetchAllCategoryItems(category) {
  const result = new Map();
  let page = 1;
  let totalPages = null;

  while (page <= MAX_PAGES) {
    await sleep();

    const url = new URL(API_BASE);
    url.searchParams.set("ac", "videolist");
    url.searchParams.set("t", category.id);
    url.searchParams.set("pg", String(page));
    url.searchParams.set("pagesize", String(PAGE_SIZE));

    const data = await fetchJson(url.toString());
    const list = validateVideoList(data, url.toString());

    if (page === 1 && data.total !== undefined && data.total !== null && data.total !== "") {
      const total = Number(data.total);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error(`Invalid total count for category: ${category.name}`);
      }
      totalPages = Math.ceil(total / PAGE_SIZE);
    }

    if (list.length === 0) {
      if (totalPages !== null && page <= totalPages) {
        if (page === 1 && totalPages === 0) break;
        throw new Error(`Pagination ended before all records were fetched: ${category.name}, page ${page}`);
      }
      break;
    }

    for (const rawItem of list) {
      const item = normalizeVideo(rawItem);
      if (item) result.set(item.id, item);
    }

    if (totalPages !== null) {
      if (page >= totalPages) break;
    } else if (list.length < PAGE_SIZE) {
      break;
    }

    page++;
  }

  if (page > MAX_PAGES) {
    throw new Error(`Pagination exceeded the safety limit for category: ${category.name}`);
  }

  return result;
}

async function fetchRecentCategoryItems(category) {
  await sleep();

  const url = new URL(API_BASE);
  url.searchParams.set("ac", "videolist");
  url.searchParams.set("t", category.id);
  url.searchParams.set("h", "24");
  url.searchParams.set("pagesize", String(PAGE_SIZE));

  const data = await fetchJson(url.toString());
  const list = validateVideoList(data, url.toString());
  const result = new Map();

  for (const rawItem of list) {
    const item = normalizeVideo(rawItem);
    if (item) result.set(item.id, item);
  }

  return result;
}

function buildCategoryFiles(category, itemsById, outputFiles) {
  const grouped = new Map();

  for (const item of itemsById.values()) {
    const letter = getLetter(item.name);
    if (!grouped.has(letter)) grouped.set(letter, []);
    grouped.get(letter).push({
      name: item.name,
      id: String(item.id)
    });
  }

  for (const [letter, items] of grouped) {
    items.sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name, "zh-Hans");
      return nameCompare || String(a.id).localeCompare(String(b.id), "en");
    });

    const fileName = `${category.name}_${letter}.json`;
    outputFiles.set(fileName, JSON.stringify(items));
  }
}

function writeFileAtomically(fileName, content) {
  const target = path.resolve(".", fileName);
  const temporary = `${target}.${process.pid}.tmp`;

  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, target);
}

function isGeneratedDataFile(fileName) {
  if (RESERVED_FILES.has(fileName)) return false;
  if (!fileName.endsWith(".json")) return false;
  return /_(?:[A-Z]|Other)\.json$/.test(fileName);
}

function removeStaleDataFiles(expectedFiles) {
  const expected = new Set(expectedFiles);

  for (const fileName of fs.readdirSync(".")) {
    if (!isGeneratedDataFile(fileName) || expected.has(fileName)) continue;
    fs.unlinkSync(fileName);
  }
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;

  const state = readJsonFile(STATE_FILE, null);
  if (!state || state.status !== "completed") {
    throw new Error("Existing sync_state.json is invalid; refusing to assume this is a first run");
  }

  return state;
}

async function main() {
  const previousState = loadState();
  const isFirstRun = previousState === null;
  const categories = await getCategories();
  const outputFiles = new Map();

  for (const category of categories) {
    console.log(`Syncing category: ${category.name}`);

    const existingItems = isFirstRun
      ? new Map()
      : readExistingCategoryItems(category.name);

    const fetchedItems = isFirstRun
      ? await fetchAllCategoryItems(category)
      : await fetchRecentCategoryItems(category);

    const mergedItems = new Map(existingItems);

    for (const [id, item] of fetchedItems) {
      mergedItems.set(id, item);
    }

    buildCategoryFiles(category, mergedItems, outputFiles);
    console.log(`Prepared ${mergedItems.size} records for ${category.name}`);
    await sleep(2000, 4000);
  }

  const categoryNames = categories.map(category => category.name);
  const expectedDataFiles = [...outputFiles.keys()];

  for (const [fileName, content] of outputFiles) {
    writeFileAtomically(fileName, content);
  }

  writeFileAtomically(
    CATEGORIES_FILE,
    JSON.stringify(categoryNames)
  );

  removeStaleDataFiles(expectedDataFiles);

  const state = {
    status: "completed",
    lastSync: new Date().toISOString(),
    categories: categoryNames,
    managedFiles: [...expectedDataFiles, CATEGORIES_FILE]
  };

  writeFileAtomically(STATE_FILE, JSON.stringify(state));
  console.log(`Sync completed: ${categories.length} categories, ${expectedDataFiles.length} data files`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
