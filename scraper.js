const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const DEFAULT_MAX_PAGES  = 100;
const DEFAULT_MAX_DEPTH  = 2;
const CONCURRENCY        = 5;   // parallel browser pages
const IDLE_TIMEOUT_MS    = 10_000; // auto-stop if no new content for 10 seconds

// ─── Public entry point ───────────────────────────────────────────────────────
async function crawlWebsite(seedUrl, onProgress, options = {}) {
  const maxPages  = options.maxPages  || DEFAULT_MAX_PAGES;
  const maxDepth  = options.maxDepth  !== undefined ? options.maxDepth : DEFAULT_MAX_DEPTH;
  const shouldStop = options.shouldStop || (() => false);

  let browser;
  try {
    onProgress({ stage: 'launching', message: 'Launching browser...' });
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    let baseHost = '';
    try { baseHost = new URL(seedUrl).hostname; } catch (_) { throw new Error('Invalid URL'); }

    // BFS state
    const visited   = new Set([normalizeUrl(seedUrl)]);
    const queue     = [{ url: seedUrl, depth: 0 }];

    // Aggregated results
    const allListings  = [];
    const nameIndex    = new Map();
    const allLinksMap  = new Map();
    let   seedFullData = null;
    let   pagesVisited = 0;

    // Idle tracking — cumulative ms spent in batches that found no new listings
    let idleMs = 0;
    let stoppedEarly = false;

    while (queue.length > 0 && pagesVisited < maxPages) {
      // ── Check stop signal ────────────────────────────────────────────────
      if (shouldStop()) {
        stoppedEarly = true;
        onProgress({ stage: 'crawling', message: 'Stop requested. Preparing results...' });
        break;
      }

      // Take up to CONCURRENCY items
      const batch = [];
      while (queue.length > 0 && batch.length < CONCURRENCY && pagesVisited + batch.length < maxPages) {
        batch.push(queue.shift());
      }

      const queueLeft = Math.min(queue.length, maxPages - pagesVisited - batch.length);
      onProgress({
        stage: 'crawling',
        message: `Scraping pages ${pagesVisited + 1}–${pagesVisited + batch.length}  (${queueLeft} more queued)…`,
        pagesVisited,
        pagesTotal: Math.min(pagesVisited + batch.length + queue.length, maxPages),
      });

      const listingsBefore = allListings.length;
      const batchStart = Date.now();

      // Fetch all pages in the batch in parallel
      const fetched = await Promise.all(
        batch.map(({ url }) => fetchPage(browser, url).catch(() => null))
      );

      for (let i = 0; i < batch.length; i++) {
        const { url: pageUrl, depth } = batch[i];
        const result = fetched[i];
        pagesVisited++;

        if (!result) continue;
        const { html, title, finalUrl } = result;

        const $ = cheerio.load(html);
        $('script, style, noscript, iframe, [hidden]').remove();

        // Full parse only for the seed page
        if (pageUrl === seedUrl && !seedFullData) {
          seedFullData = parseHTML(html, seedUrl, title, finalUrl, onProgress);
        }

        // Extract company listings from this page
        const pageListings = extractListings($, finalUrl);
        for (const listing of pageListings) {
          mergeListingIn(listing, allListings, nameIndex);
        }

        // Collect all links; queue same-host links if depth allows
        $('a[href]').each((_, a) => {
          const href = $(a).attr('href') || '';
          if (!href || href.startsWith('#') || href.startsWith('javascript:')
              || href.startsWith('mailto:') || href.startsWith('tel:')) return;

          let abs;
          try { abs = new URL(href, finalUrl).href; } catch (_) { return; }

          const text = $(a).text().trim();
          if (!allLinksMap.has(abs)) allLinksMap.set(abs, text || '(no text)');

          if (depth < maxDepth) {
            try {
              if (new URL(abs).hostname === baseHost) {
                const norm = normalizeUrl(abs);
                if (!visited.has(norm)) {
                  visited.add(norm);
                  queue.push({ url: abs, depth: depth + 1 });
                }
              }
            } catch (_) {}
          }
        });
      }

      // ── Idle tracking: accumulate time only when no new listings found ───
      if (allListings.length > listingsBefore) {
        idleMs = 0;  // found listings — reset idle counter
      } else {
        idleMs += Date.now() - batchStart;
      }

      // ── Auto-stop if idle for 10+ cumulative seconds ─────────────────────
      if (pagesVisited > 0 && idleMs >= IDLE_TIMEOUT_MS) {
        stoppedEarly = true;
        onProgress({ stage: 'crawling', message: 'No listings found for 10 seconds. Auto-stopping...' });
        break;
      }
    }

    // Build final result
    const result = seedFullData || {
      meta: {
        url: seedUrl, originalUrl: seedUrl, title: '',
        scrapedAt: new Date().toISOString(), description: '', keywords: '',
      },
      tables: [], headings: [], paragraphs: [], lists: [], images: [],
    };

    result.listings   = allListings;
    result.links      = Array.from(allLinksMap.entries()).map(([url, text]) => ({ url, text }));
    result.crawlStats = { pagesVisited, listingsFound: allListings.length, stoppedEarly };

    const doneMsg = stoppedEarly
      ? `Stopped early after ${pagesVisited} page${pagesVisited !== 1 ? 's' : ''} — ${allListings.length} companies found.`
      : `Done! Crawled ${pagesVisited} page${pagesVisited !== 1 ? 's' : ''} — ${allListings.length} companies found.`;

    onProgress({ stage: 'done', message: doneMsg });

    return result;
  } finally {
    if (browser) await browser.close();
  }
}

// ─── Fetch a single page ──────────────────────────────────────────────────────
async function fetchPage(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await autoScroll(page);
    const html     = await page.content();
    const title    = await page.title();
    const finalUrl = page.url();
    return { html, title, finalUrl };
  } finally {
    await page.close();
  }
}

// ─── Merge a listing into the global list (enrich if name already seen) ───────
function mergeListingIn(listing, allListings, nameIndex) {
  if (!listing.name || listing.name.length < 2) return;
  const key = listing.name.toLowerCase().trim();

  if (nameIndex.has(key)) {
    const existing = allListings[nameIndex.get(key)];
    const fields = ['hall','stand','website','facebook','instagram','youtube','twitter','linkedin','otherLinks'];
    for (const f of fields) {
      if (!existing[f] && listing[f]) existing[f] = listing[f];
    }
  } else {
    nameIndex.set(key, allListings.length);
    allListings.push(listing);
  }
}

// ─── Normalise URL for dedup (strip trailing slash and fragment) ──────────────
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch (_) { return raw; }
}

// ─── Auto-scroll to trigger lazy-loaded content ───────────────────────────────
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= Math.min(document.body.scrollHeight, 10000)) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

// ─── Full HTML parse (used only on seed page) ────────────────────────────────
function parseHTML(html, originalUrl, pageTitle, finalUrl, onProgress) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, [hidden]').remove();

  const result = {
    meta: {
      title: pageTitle,
      url: finalUrl,
      originalUrl,
      scrapedAt: new Date().toISOString(),
      description: $('meta[name="description"]').attr('content') || '',
      keywords:    $('meta[name="keywords"]').attr('content')    || '',
    },
    listings: [],
    tables:   [],
    links:    [],
    headings: [],
    paragraphs: [],
    lists:    [],
    images:   [],
  };

  // Tables
  onProgress({ stage: 'extracting', message: 'Extracting tables…' });
  $('table').each((i, table) => {
    const headers = [];
    const rows = [];

    $(table).find('thead tr th, thead tr td').each((_, th) => {
      headers.push($(th).text().trim());
    });

    let firstRow = true;
    $(table).find('tr').each((_, tr) => {
      const cells = [];
      $(tr).find('td, th').each((_, td) => cells.push($(td).text().trim()));
      if (cells.length === 0) return;
      if (headers.length === 0 && firstRow) { headers.push(...cells); firstRow = false; return; }
      firstRow = false;
      rows.push(cells);
    });

    if (headers.length > 0 || rows.length > 0)
      result.tables.push({ index: i + 1, headers, rows });
  });

  // Headings
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const text = $(el).text().trim();
    if (text) result.headings.push({ level: el.tagName.toLowerCase(), text });
  });

  // Paragraphs
  $('p').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 20) result.paragraphs.push({ text });
  });

  // Lists
  $('ul,ol').each((_, list) => {
    const items = [];
    $(list).find('> li').each((_, li) => {
      const text = $(li).text().trim();
      if (text) items.push(text);
    });
    if (items.length > 0) result.lists.push({ type: list.tagName.toLowerCase(), items });
  });

  // Images
  $('img').each((_, img) => {
    const src = $(img).attr('src') || '';
    const alt = $(img).attr('alt') || '';
    if (!src) return;
    let absoluteSrc = src;
    try { absoluteSrc = new URL(src, finalUrl).href; } catch (_) {}
    result.images.push({ src: absoluteSrc, alt });
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTING EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────
function extractListings($, finalUrl) {
  let baseHost = '';
  try { baseHost = new URL(finalUrl).hostname; } catch (_) {}

  const candidateSelectors = [
    '[class*="exhibitor"]', '[class*="company"]', '[class*="vendor"]',
    '[class*="participant"]', '[class*="brand"]', '[class*="booth"]',
    '[class*="listing"]', '[class*="card"]', '[class*="item"]',
    '[class*="result"]', '[class*="entry"]', '[class*="profile"]',
    '[class*="member"]', 'article', 'li',
  ];

  let bestElements = [];
  for (const sel of candidateSelectors) {
    const els = $(sel);
    if (els.length >= 3 && els.length > bestElements.length) {
      let withLinks = 0;
      els.each((_, el) => { if ($(el).find('a[href]').length > 0) withLinks++; });
      if (withLinks / els.length > 0.4) bestElements = els.toArray();
    }
  }

  if (bestElements.length === 0) {
    $('div').each((_, el) => {
      const $el = $(el);
      if ($el.find('a[href]').length >= 1 && $el.find('h1,h2,h3,h4,h5,h6,strong').length >= 1)
        bestElements.push(el);
    });
  }

  const isSinglePage = bestElements.length === 0;
  if (isSinglePage) bestElements = [$('body')[0]].filter(Boolean);

  const listings = [];
  const seen = new Set();

  bestElements.forEach((el) => {
    const $el = $(el);

    const name = (
      $el.find('h1,h2,h3,h4,h5,h6').first().text().trim() ||
      $el.find('strong, b, .title, .name, [class*="name"], [class*="title"]').first().text().trim() ||
      $el.find('a').first().text().trim()
    ).replace(/\s+/g, ' ').trim();

    if (!name || name.length < 2 || seen.has(name)) return;
    seen.add(name);

    const rawText = $el.text().replace(/\s+/g, ' ');

    const hallPattern  = /(?:hall|pavilion|zone|sheikh\s+\w+)[^,\n]{0,60}/i;
    const standPattern = /(?:stand|booth|stand\s*no)[^\w]*([A-Z]{0,3}[\-]?\d+[A-Z]?\d*)/i;
    const standCode    = /\b([A-Z]{1,3}[\-]\w{1,5})\b/;

    let hall  = '';
    let stand = '';

    const hallMatch  = rawText.match(hallPattern);
    if (hallMatch) hall = hallMatch[0].trim();

    const standMatch = rawText.match(standPattern);
    if (standMatch) stand = standMatch[1];
    else {
      const codeMatch = rawText.match(standCode);
      if (codeMatch) stand = codeMatch[1];
    }

    if (hall && stand && !hall.toLowerCase().includes('stand'))
      hall = `${hall}  Stand: ${stand}`;

    let website = '', facebook = '', instagram = '', youtube = '', twitter = '', linkedin = '';
    const others = [];

    $el.find('a[href]').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')
          || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      let abs = href;
      try { abs = new URL(href, finalUrl).href; } catch (_) { return; }
      const lower = abs.toLowerCase();

      if      (lower.includes('facebook.com') || lower.includes('fb.com'))       { if (!facebook)  facebook  = abs; }
      else if (lower.includes('instagram.com'))                                   { if (!instagram) instagram = abs; }
      else if (lower.includes('youtube.com')  || lower.includes('youtu.be'))     { if (!youtube)   youtube   = abs; }
      else if (lower.includes('twitter.com')  || lower.includes('x.com/'))       { if (!twitter)   twitter   = abs; }
      else if (lower.includes('linkedin.com'))                                    { if (!linkedin)  linkedin  = abs; }
      else if (!lower.includes(baseHost)) {
        if (!website) website = abs;
        else          others.push(abs);
      }
    });

    listings.push({
      name, hall, stand,
      website, facebook, instagram, youtube, twitter, linkedin,
      otherLinks: others.join(' | '),
    });
  });

  return listings;
}

module.exports = { crawlWebsite };
