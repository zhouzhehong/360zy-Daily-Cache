const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fetchCategoryPages, runSync, readState } = require('./fetch.js');

function response(data) {
  return { ok: true, status: 200, json: async () => data };
}

function createItems(start, count) {
  return Array.from({ length: count }, (_, index) => ({
    vod_id: String(start + index),
    vod_name: `Movie ${start + index}`
  }));
}

function createFetch(categories, pageHandler) {
  return async input => {
    const url = new URL(String(input));
    if (url.searchParams.get('ac') === 'list') return response({ class: categories });
    if (url.searchParams.get('ac') === 'videolist') {
      return response(await pageHandler({
        category: url.searchParams.get('t'),
        page: Number(url.searchParams.get('pg')),
        hours: url.searchParams.get('h'),
        pageSize: Number(url.searchParams.get('pagesize'))
      }));
    }
    throw new Error(`Unexpected API URL: ${url}`);
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), '360zy-test-'));
}

test('automatically fetches every page declared by the API', async () => {
  const fetchImpl = createFetch([{ type_id: 1, type_name: '电影' }], async ({ page }) => {
    if (page === 1) return { total: 250, pagecount: 3, list: createItems(1, 100) };
    if (page === 2) return { total: 250, pagecount: 3, list: createItems(101, 100) };
    return { total: 250, pagecount: 3, list: createItems(201, 50) };
  });
  const result = await fetchCategoryPages({ id: '1', name: '电影' }, { fetchImpl, wait: async () => {} });
  assert.equal(result.items.size, 250);
  assert.equal(result.stats.successful_pages, 3);
  assert.equal(result.stats.complete, true);
});

test('uses dynamically returned pagecount', async () => {
  let requestedPages = 0;
  const fetchImpl = createFetch([{ type_id: 99, type_name: '测试分类' }], async ({ page }) => {
    requestedPages++;
    return { total: 3, pagecount: 3, list: [{ vod_id: String(page), vod_name: `Test ${page}` }] };
  });
  const result = await fetchCategoryPages({ id: '99', name: '测试分类' }, { fetchImpl, wait: async () => {} });
  assert.equal(requestedPages, 3);
  assert.equal(result.items.size, 3);
});

test('fails when pagination metadata is missing', async () => {
  const fetchImpl = createFetch([{ type_id: 1, type_name: '电影' }], async () => ({ list: createItems(1, 1) }));
  await assert.rejects(
    fetchCategoryPages({ id: '1', name: '电影' }, { fetchImpl, wait: async () => {} }),
    /Missing pagination field/
  );
});

test('fails when API total does not match fetched records', async () => {
  const fetchImpl = createFetch(
    [{ type_id: 1, type_name: '电影' }],
    async ({ page }) => ({
      total: 250,
      pagecount: 2,
      list: page === 1
        ? createItems(1, 100)
        : createItems(101, 100)
    })
  );

  await assert.rejects(
    fetchCategoryPages(
      { id: '1', name: '电影' },
      {
        fetchImpl,
        wait: async () => {}
      }
    ),
    /Record count mismatch/
  );
});

test('fails when a page is repeated', async () => {
  const repeated = createItems(1, 2);
  const fetchImpl = createFetch([{ type_id: 1, type_name: '电影' }], async () => ({ total: 4, pagecount: 2, list: repeated }));
  await assert.rejects(
    fetchCategoryPages({ id: '1', name: '电影' }, { fetchImpl, wait: async () => {} }),
    /Repeated page detected/
  );
});

test('incremental mode requests the 24-hour API filter', async () => {
  const directory = makeTempDir();
  try {
    const initialFetch = createFetch([{ type_id: 1, type_name: '电影' }], async () => ({ total: 1, pagecount: 1, list: createItems(1, 1) }));
    await runSync({ rootDir: directory, fullSync: true, fetchImpl: initialFetch, wait: async () => {} });
    let observedHours = null;
    const incrementalFetch = createFetch([{ type_id: 1, type_name: '电影' }], async ({ hours }) => {
      observedHours = hours;
      return { total: 1, pagecount: 1, list: createItems(2, 1) };
    });
    await runSync({ rootDir: directory, fullSync: false, fetchImpl: incrementalFetch, wait: async () => {} });
    assert.equal(observedHours, '24');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('failed category preserves previously committed files', async () => {
  const directory = makeTempDir();
  try {
    const initialFetch = createFetch([{ type_id: 1, type_name: '电影' }], async () => ({ total: 1, pagecount: 1, list: createItems(1, 1) }));
    await runSync({ rootDir: directory, fullSync: true, fetchImpl: initialFetch, wait: async () => {} });

    const before = new Map();
    for (const file of fs.readdirSync(directory)) {
      const fullPath = path.join(directory, file);
      if (fs.statSync(fullPath).isFile()) before.set(file, fs.readFileSync(fullPath));
    }

    const failingFetch = createFetch(
      [{ type_id: 1, type_name: '电影' }, { type_id: 2, type_name: '电视剧' }],
      async ({ category }) => {
        if (category === '1') return { total: 1, pagecount: 1, list: createItems(10, 1) };
        throw new Error('Simulated API failure');
      }
    );

    await assert.rejects(
      runSync({ rootDir: directory, fullSync: true, fetchImpl: failingFetch, wait: async () => {} }),
      /Request failed after 3 attempts/
    );

    for (const [file, oldContent] of before) {
      const current = fs.readFileSync(path.join(directory, file));
      assert.deepEqual(current, oldContent);
    }
    assert.equal(readState(directory).status, 'completed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unknown JSON files are never deleted', async () => {
  const directory = makeTempDir();
  try {
    const protectedFile = path.join(directory, 'important.json');
    fs.writeFileSync(protectedFile, JSON.stringify({ keep: true }));
    const fetchImpl = createFetch([{ type_id: 1, type_name: '电影' }], async () => ({ total: 1, pagecount: 1, list: createItems(1, 1) }));
    await runSync({ rootDir: directory, fullSync: true, fetchImpl, wait: async () => {} });
    assert.equal(fs.existsSync(protectedFile), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(protectedFile, 'utf8')), { keep: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
