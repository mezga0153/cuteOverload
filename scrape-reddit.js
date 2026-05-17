#!/usr/bin/env node
// scrape-reddit.js — run on mediabox (residential IP, Reddit allows it)
// Fetches images from dog/cat subreddits and pushes them to the prod ingest endpoint.
//
// Required env vars:
//   PROD_URL      — e.g. https://cuteoverload.tinetov.net
//   ADMIN_SECRET  — must match ADMIN_SECRET on prod server

const PROD_URL     = process.env.PROD_URL     || 'https://cuteoverload.tinetov.net';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) { console.error('ADMIN_SECRET env var required'); process.exit(1); }

const SUBREDDITS = {
  dogs: [
    'dogpics', 'puppies', 'rarepuppers', 'goldenretrievers', 'aww',
    'dogswithjobs', 'WhatsWrongWithYourDog', 'husky', 'corgi', 'germanshepherd',
    'pitbulls', 'labrador', 'shiba', 'bordercollie', 'poodle',
    'beagle', 'dachshund', 'samoyeds', 'greatdanes', 'akita',
    'Dogtraining', 'rescuedogs', 'lookatmydog', 'ThisIsMyLifeNow', 'dogswearinghats',
    'maltese', 'siberianhusky', 'boxers', 'australianshepherd', 'weimaraner',
  ],
  cats: [
    'cats', 'catpics', 'IllegallySmolCats', 'kittens', 'aww',
    'CatsStandingUp', 'Chonkers', 'blackcats', 'orangecats', 'tabbycats',
    'mainecoons', 'bengalcats', 'scottishfold', 'AbyssinianCats', 'ragdolls',
    'siamesecats', 'calico', 'polydactyl', 'fluffycats', 'CatsInSinks',
    'catsinboxes', 'blep', 'Catswhoyell', 'sleepingcats', 'lordkitty',
    'nothavingit', 'TuxedoCats', 'torties', 'snowcats', 'CatsOnKeyboards',
  ],
};

const LISTINGS = ['hot', 'top?t=week', 'top?t=month', 'top?t=all', 'new'];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i;

function extractImageUrl(post) {
  if (post.url && IMAGE_RE.test(post.url)) return post.url;
  if (post.media_metadata) {
    const first = Object.values(post.media_metadata)[0];
    const url = first?.s?.u || first?.s?.gif;
    if (url) return url.replace(/&amp;/g, '&');
  }
  const preview = post.preview?.images?.[0]?.source?.url;
  if (preview) return preview.replace(/&amp;/g, '&');
  return null;
}

async function fetchListing(subreddit, listing) {
  const url = `https://www.reddit.com/r/${subreddit}/${listing}.json?limit=100`;
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) { console.warn(`  ${subreddit}/${listing}: HTTP ${res.status}`); return []; }
    const json = await res.json();
    return (json?.data?.children ?? [])
      .map((c) => c.data)
      .filter((p) => !p.is_video && !p.stickied)
      .flatMap((p) => {
        const imageUrl = extractImageUrl(p);
        return imageUrl ? [{ url: imageUrl, title: p.title ?? '', source: `reddit.com/r/${subreddit}` }] : [];
      });
  } catch (e) {
    console.warn(`  ${subreddit}/${listing}: ${e.message}`);
    return [];
  }
}

async function scrapeType(type) {
  console.log(`\n[${type}] scraping ${SUBREDDITS[type].length} subreddits…`);
  const seen = new Set();
  const images = [];
  for (const subreddit of SUBREDDITS[type]) {
    for (const listing of LISTINGS) {
      const results = await fetchListing(subreddit, listing);
      for (const img of results) {
        if (!seen.has(img.url)) { seen.add(img.url); images.push(img); }
      }
      await new Promise((r) => setTimeout(r, 1_000)); // 1 req/s — be polite
    }
  }
  console.log(`[${type}] found ${images.length} unique images, pushing to prod…`);

  // Push in batches of 50
  let totalInserted = 0;
  for (let i = 0; i < images.length; i += 50) {
    const batch = images.slice(i, i + 50);
    try {
      const res = await fetch(`${PROD_URL}/admin/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_SECRET}` },
        body: JSON.stringify({ type, images: batch }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) { console.error(`  ingest batch ${i}-${i + batch.length}: HTTP ${res.status}`); continue; }
      const { inserted } = await res.json();
      totalInserted += inserted;
      console.log(`  batch ${i + batch.length}/${images.length} → ${inserted} new`);
      await new Promise((r) => setTimeout(r, 2_000)); // 2s between ingest batches
    } catch (e) {
      console.error(`  ingest batch ${i}: ${e.message}`);
    }
  }
  console.log(`[${type}] done — ${totalInserted} new images inserted`);
}

console.log(`cuteOverload Reddit scraper — ${new Date().toISOString()}`);
console.log(`Target: ${PROD_URL}`);
await scrapeType('dogs');
await scrapeType('cats');
console.log('\nAll done.');
