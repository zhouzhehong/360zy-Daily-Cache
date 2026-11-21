const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('Pagination Logic', () => {
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    process.env.FULL_SYNC = 'false';
    if (fs.existsSync('sync_state.json')) fs.unlinkSync('sync_state.json');
    const files = fs.readdirSync('.').filter(f => f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json');
    files.forEach(f => fs.unlinkSync(f));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    if (fs.existsSync('sync_state.json')) fs.unlinkSync('sync_state.json');
    const files = fs.readdirSync('.').filter(f => f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json');
    files.forEach(f => fs.unlinkSync(f));
  });

  it('should fetch 250 items in 3 pages correctly', async () => {
    global.fetch = async (url) => {
      url = url.toString();
      if (url.includes('ac=list')) {
        return { ok: true, json: async () => ({ class: [{ type_id: 1, type_name: '电影' }] }) };
      }
      if (url.includes('ac=videolist')) {
        const page = parseInt(new URL(url).searchParams.get('pg'));
        const list = [];
        const count = page < 3 ? 100 : 50;
        for (let i = 0; i < count; i++) {
          list.push({ vod_id: `${(page - 1) * 100 + i}`, vod_name: `Movie ${(page - 1) * 100 + i}` });
        }
        return { ok: true, json: async () => ({ list, total: 250, pagecount: 3 }) };
      }
    };
    require('./fetch.js');
    await new Promise(r => setTimeout(r, 1000));
    const state = JSON.parse(fs.readFileSync('sync_state.json'));
    expect(state.statistics.uniqueCount).to.equal(250);
    expect(state.statistics.successfulPages).to.equal(3);
  });

  it('should fail whole category if page 2 fails', async () => {
    global.fetch = async (url) => {
      url = url.toString();
      if (url.includes('ac=list')) return { ok: true, json: async () => ({ class: [{ type_id: 1, type_name: '电影' }] }) };
      if (url.includes('ac=videolist')) {
        const page = parseInt(new URL(url).searchParams.get('pg'));
        if (page === 2) throw new Error('Simulated network failure');
        return { ok: true, json: async () => ({ list: [{ vod_id: '1', vod_name: 'A' }], total: 200, pagecount: 2 }) };
      }
    };
    const exitStub = { callCount: 0 };
    const originalExit = process.exit;
    process.exit = () => { exitStub.callCount++; throw new Error('Exit called'); };
    try { require('./fetch.js'); } catch (e) {}
    process.exit = originalExit;
    expect(exitStub.callCount).to.be.greaterThan(0);
  });

  it('should preserve historical data during incremental sync', async () => {
    fs.writeFileSync('电影_A.json', JSON.stringify([{ id: '1', name: 'Old Movie' }]));
    global.fetch = async (url) => {
      url = url.toString();
      if (url.includes('ac=list')) return { ok: true, json: async () => ({ class: [{ type_id: 1, type_name: '电影' }] }) };
      if (url.includes('ac=videolist')) {
        return { ok: true, json: async () => ({ list: [{ vod_id: '2', vod_name: 'New Movie' }], total: 1, pagecount: 1 }) };
      }
    };
    require('./fetch.js');
    await new Promise(r => setTimeout(r, 1000));
    const content = JSON.parse(fs.readFileSync('电影_A.json'));
    expect(content.length).to.equal(2);
    expect(content.find(i => i.id === '1')).to.exist;
    expect(content.find(i => i.id === '2')).to.exist;
  });
});
