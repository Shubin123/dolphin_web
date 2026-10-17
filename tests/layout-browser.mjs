// Workspace layout: the screen tile and widgets share one grid, nothing
// overlaps or scrolls sideways, and the Game Library stays usable at every
// widget width. Geometry is measured in a real browser at several viewports.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve('web');
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/dolphin_web/')) { response.writeHead(404).end(); return; }
    const file = resolve(root, decodeURIComponent(url.pathname.slice('/dolphin_web/'.length)) || 'index.html');
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/dolphin_web/`;

// Long titles are what used to push the actions out of a half-width widget.
const catalog = ['The Legend of Zelda - Twilight Princess (Europe) (En,Fr,De,Es,It).iso', 'Xenoblade Chronicles (Europe) (En,Fr,De,Es,It).iso',
  'Super Mario Galaxy 2 (USA) (En,Fr,Es).iso', 'Wii Sports (USA).iso', 'Metroid Prime 3 - Corruption (Japan).iso']
  .map((name, i) => ({name, size:4.3e9 + i * 1e8}));

let browser;
const errors = [];
async function open(viewport, layout) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  page.on('request', request => request.url() === 'https://archive.org/metadata/Wii_ISO'
    ? request.respond({status:200, headers:{'access-control-allow-origin':'*','content-type':'application/json'}, body:JSON.stringify({files:catalog})})
    : request.continue());
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(layout => {
    if (sessionStorage.getItem('layout-seeded')) return;
    sessionStorage.setItem('layout-seeded', '1');
    localStorage.clear();
    if (layout) localStorage.setItem('dolphin-widget-layout', JSON.stringify(layout));
  }, layout);
  await page.goto(origin);
  await page.waitForFunction(() => window.DolphinLayout && document.querySelector('.library-section')?.dataset.catalogLoaded === 'true'
    && document.querySelectorAll('#libraryRows tr[data-name]').length === 5, {timeout:60000});
  await settle(page);
  return page;
}
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 50)))));

// Everything the checks need, measured in one pass.
const measure = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top + scrollY, bottom:r.bottom + scrollY, width:r.width, height:r.height}; };
  const library = document.querySelector('.library-section');
  const scroll = library.querySelector('.library-table-scroll');
  const rows = [...library.querySelectorAll('#libraryRows tr[data-name]')].map(row => {
    const controls = [...row.lastElementChild.children].map(box);
    return {row:box(row), title:row.firstElementChild.scrollWidth <= row.firstElementChild.clientWidth + 1, controls};
  });
  const viewport = document.querySelector('.screen-viewport');
  return {
    innerWidth, innerHeight,
    pageWidth: document.documentElement.scrollWidth,
    cols: DolphinLayout.columns(), screenCols: DolphinLayout.screenColumns(),
    screen: box(document.querySelector('.play-area')),
    picture: {...box(viewport), viewportBottom: viewport.getBoundingClientRect().bottom},
    fullRow: document.querySelector('.play-area').classList.contains('is-full-row'),
    cards: [...document.querySelectorAll('#widget-grid > .card:not([hidden])')].map(card => ({id:card.dataset.widget, ...box(card)})),
    library: {...box(library), scrollFits: scroll.scrollWidth <= scroll.clientWidth + 1,
      headerShown: getComputedStyle(library.querySelector('thead')).display !== 'none',
      search: box(library.querySelector('#librarySearch')), rows},
  };
});

const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
function checkCommon(m, label) {
  assert.ok(m.pageWidth <= m.innerWidth, `${label}: page must not scroll sideways (${m.pageWidth} > ${m.innerWidth})`);
  for (const [i, a] of m.cards.entries()) {
    assert.ok(!overlaps(a, m.screen), `${label}: ${a.id} overlaps the screen`);
    for (const b of m.cards.slice(i + 1)) assert.ok(!overlaps(a, b), `${label}: ${a.id} overlaps ${b.id}`);
  }
  const lib = m.library;
  assert.ok(lib.scrollFits, `${label}: library table must fit its widget without a sideways scroll`);
  assert.ok(lib.search.width >= 140, `${label}: search field must stay usable (${lib.search.width}px)`);
  for (const {row, title, controls} of lib.rows) {
    assert.ok(title, `${label}: game titles must wrap, not clip`);
    for (const control of controls) {
      assert.ok(control.left >= lib.left && control.right <= lib.right + 0.5, `${label}: row actions must stay inside the widget`);
      assert.ok(control.top >= row.top - 0.5 && control.bottom <= row.bottom + 0.5, `${label}: row actions must stay inside their row`);
    }
    assert.equal(new Set(controls.map(c => Math.round(c.top))).size, 1, `${label}: Download / Play / Cache must share one line`);
  }
}

try {
  browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--enable-unsafe-webgpu', ...(process.env.CI ? ['--no-sandbox'] : [])]});

  // Desktop, default layout: the screen fits the window height beside at
  // least two widget columns, and the auto-width library fills the space
  // directly under it.
  for (const viewport of [{width:1440,height:900}, {width:1920,height:1080}, {width:2560,height:1440}]) {
    const label = `${viewport.width}x${viewport.height}`;
    const page = await open(viewport);
    const m = await measure(page);
    checkCommon(m, label);
    assert.equal(m.fullRow, false, `${label}: screen sits beside the widgets`);
    assert.ok(m.cols - m.screenCols >= 2, `${label}: at least two widget columns beside the screen`);
    assert.ok(m.picture.viewportBottom <= m.innerHeight + 1, `${label}: the picture fits the window height`);
    assert.ok(m.cards.some(card => card.left >= m.screen.right && card.top < m.screen.bottom), `${label}: widgets use the space beside the screen`);
    assert.ok(Math.abs(m.library.left - m.screen.left) < 1 && Math.abs(m.library.width - m.screen.width) < 1, `${label}: library spans the screen's columns`);
    assert.ok(m.library.top >= m.screen.bottom && m.library.top - m.screen.bottom <= 20, `${label}: library starts right under the screen (gap ${m.library.top - m.screen.bottom}px)`);
    assert.equal(m.library.headerShown, true, `${label}: a wide library keeps its table`);
    await page.close();
  }

  // Half-width library (one column): compact rows without a table header.
  for (const viewport of [{width:1280,height:800}, {width:1440,height:900}, {width:1920,height:1080}]) {
    const label = `${viewport.width}x${viewport.height} library 1 col`;
    const page = await open(viewport, {widgets:{library:{span:1}}});
    const m = await measure(page);
    checkCommon(m, label);
    assert.ok(m.library.width < 400, `${label}: library is one column wide`);
    assert.equal(m.library.headerShown, false, `${label}: narrow library hides the table header`);
    await page.close();
  }

  // Two columns: wide enough for neither cramped table nor clipped search.
  {
    const page = await open({width:1920,height:1080}, {widgets:{library:{span:2}}});
    checkCommon(await measure(page), '1920x1080 library 2 col');
    await page.close();
  }

  // Phone, tablet and "widgets below": the screen takes the first row and
  // every widget comes after it.
  for (const [viewport, layout, label] of [[{width:390,height:844}, null, 'phone'], [{width:800,height:1000}, null, 'tablet'], [{width:1920,height:1080}, {beside:false}, 'widgets below']]) {
    const page = await open(viewport, layout);
    const m = await measure(page);
    checkCommon(m, label);
    assert.equal(m.fullRow, true, `${label}: screen takes the whole first row`);
    for (const card of m.cards) assert.ok(card.top >= m.screen.bottom, `${label}: ${card.id} is below the screen`);
    await page.close();
  }

  // Live behaviour: a shorter window shrinks the screen tile and the library
  // follows it; the width button cycles through auto; auto persists.
  {
    const page = await open({width:1920,height:1080});
    const tall = await measure(page);
    await page.setViewport({width:1920,height:760});
    await settle(page);
    const short = await measure(page);
    checkCommon(short, '1920x760');
    assert.ok(short.screenCols < tall.screenCols, 'a shorter window gives the screen fewer columns');
    assert.ok(Math.abs(short.library.width - short.screen.width) < 1, 'auto-width library follows the screen');

    assert.equal(await page.evaluate(() => DolphinLayout.getState().widgets.library.span), 0, 'library defaults to auto width');
    const spans = [];
    for (let i = 0; i < 5; i++) {
      await page.click('[data-widget="library"] .widget-tool-span');
      spans.push(await page.evaluate(() => DolphinLayout.getState().widgets.library.span));
    }
    assert.deepEqual(spans, [1, 2, 3, 4, 0], 'width button cycles 1..4 then back to auto');
    await page.click('[data-widget="library"] .widget-tool-span');
    await settle(page);
    const narrow = await measure(page);
    checkCommon(narrow, 'cycled to 1 col');
    assert.equal(narrow.library.headerShown, false);

    await page.click('#btn-layout-menu');
    const select = '[data-widget-id="library"] select';
    assert.equal(await page.$eval(select, el => el.options[0].textContent), 'Auto');
    await page.select(select, '0');
    await page.click('#btn-layout-menu-close');
    await page.reload();
    await page.waitForFunction(() => window.DolphinLayout && document.querySelectorAll('#libraryRows tr[data-name]').length === 5, {timeout:60000});
    await settle(page);
    const restored = await measure(page);
    assert.equal(await page.evaluate(() => DolphinLayout.getState().widgets.library.span), 0, 'auto width persists');
    assert.ok(Math.abs(restored.library.width - restored.screen.width) < 1);
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log('PASS: workspace grid layout, screen fit, library at auto/1/2 columns, phone/tablet/below modes, live resize and auto-width persistence.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
