import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { incrementLikes, incrementSuperlikes, getTopSuperlikes, getById, getByType, countImages } from './db.js';
import { ensureHosted } from './imagecodex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Subreddit lists ──────────────────────────────────────────────────────────
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

// Listing types fetched per subreddit — 6 × 100 posts = up to 600 unique per sub
const REDDIT_LISTINGS = ['hot', 'top?t=week', 'top?t=month', 'top?t=year', 'top?t=all', 'new'];

// ── In-memory cache ──────────────────────────────────────────────────────────
const cache = new Map();
const UPLOAD_BATCH = 10;
const IMAGE_TARGET = 10_000;
const FETCH_RETRY_INTERVAL_MS = 30 * 60 * 1000; // 30 min between rounds

// ── Reddit helpers ───────────────────────────────────────────────────────────

function extractImageUrl(post) {
  const directRe = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i;
  if (post.url && directRe.test(post.url)) return post.url;
  if (post.media_metadata) {
    const first = Object.values(post.media_metadata)[0];
    const url = first?.s?.u || first?.s?.gif;
    if (url) return url.replace(/&amp;/g, '&');
  }
  const preview = post.preview?.images?.[0]?.source?.url;
  if (preview) return preview.replace(/&amp;/g, '&');
  return null;
}

async function fetchSubredditListing(subreddit, listing) {
  const url = `https://www.reddit.com/r/${subreddit}/${listing}.json?limit=100`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'DogsAndCatsApp/1.0 (educational project)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Reddit r/${subreddit}/${listing}: HTTP ${res.status}`);
  const json = await res.json();
  return (json?.data?.children ?? [])
    .map((c) => c.data)
    .filter((p) => !p.is_video && !p.stickied)
    .map((p) => {
      const imageUrl = extractImageUrl(p);
      return imageUrl
        ? { url: imageUrl, title: p.title ?? '', source: `reddit.com/r/${subreddit}` }
        : null;
    })
    .filter(Boolean);
}

function fetchSubreddit(subreddit) {
  // Fetch all listing types in parallel and flatten
  return Promise.allSettled(
    REDDIT_LISTINGS.map((listing) => fetchSubredditListing(subreddit, listing))
  ).then((results) =>
    results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
  );
}

// ── Dog API / Cat API helpers ─────────────────────────────────────────────────

const ANIMAL_APIS = {
  dogs: 'https://api.thedogapi.com/v1/images/search',
  cats: 'https://api.thecatapi.com/v1/images/search',
};
const API_MAX_PAGES  = 200; // 200 × 100 = up to 20 k candidates per type
const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i;

async function fetchAnimalApiPage(type, page) {
  const url = `${ANIMAL_APIS[type]}?limit=100&page=${page}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DogsAndCatsApp/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Animal API HTTP ${res.status}`);
  const json = await res.json();
  return (Array.isArray(json) ? json : [])
    .filter((item) => item.url && IMAGE_RE.test(item.url))
    .map((item) => ({ url: item.url, title: '', source: new URL(ANIMAL_APIS[type]).hostname }));
}

async function fetchAnimalApiCandidates(type) {
  const results = [];
  for (let page = 0; page < API_MAX_PAGES; page++) {
    try {
      const batch = await fetchAnimalApiPage(type, page);
      if (batch.length === 0) break; // API signals no more data
      results.push(...batch);
    } catch {
      break;
    }
  }
  console.log(`[${type}] animal API: ${results.length} candidates from ${ANIMAL_APIS[type]}`);
  return results;
}

// ── Image pipeline ───────────────────────────────────────────────────────────

const fetching = new Set();

// ── Background fetch loop ────────────────────────────────────────────────────
// Runs both dog/cat pipelines repeatedly until IMAGE_TARGET is reached.
async function startFetchLoop() {
  while (true) {
    const total = countImages();
    if (total >= IMAGE_TARGET) {
      console.log(`[fetch] target reached: ${total}/${IMAGE_TARGET} — stopping`);
      break;
    }
    console.log(`[fetch] starting round — ${total}/${IMAGE_TARGET} in DB`);
    await Promise.allSettled([runFetch('dogs'), runFetch('cats')]);
    const newTotal = countImages();
    console.log(`[fetch] round done — ${newTotal}/${IMAGE_TARGET} in DB`);
    if (newTotal >= IMAGE_TARGET) break;
    console.log(`[fetch] next round in 30 min`);
    await new Promise((r) => setTimeout(r, FETCH_RETRY_INTERVAL_MS));
  }
}

async function runFetch(type) {
  if (fetching.has(type)) return;
  fetching.add(type);
  try {
    // Fetch Reddit and dedicated animal API in parallel
    const [redditSettled, apiResults] = await Promise.all([
      Promise.allSettled(SUBREDDITS[type].map(fetchSubreddit)),
      fetchAnimalApiCandidates(type),
    ]);

    const seen = new Set();
    const candidates = [
      ...redditSettled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value),
      ...apiResults,
    ].filter((img) => {
        if (!img || seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
      });

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const confirmed = [];
    for (let i = 0; i < candidates.length && confirmed.length < IMAGE_TARGET; i += UPLOAD_BATCH) {
      const batch   = candidates.slice(i, i + UPLOAD_BATCH);
      const results = await Promise.allSettled(batch.map((img) => ensureHosted(img, type)));
      confirmed.push(
        ...results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value)
      );
      console.log(`[${type}] confirmed ${confirmed.length}/${IMAGE_TARGET} (checked ${i + batch.length}/${candidates.length})`);
    }

    cache.set(type, { ts: Date.now(), data: confirmed });
  } catch (err) {
    console.error(`[${type}] background fetch error:`, err.message);
  } finally {
    fetching.delete(type);
  }
}

function dbRow(row) {
  return { ic_id: row.ic_id, url: row.ic_url, title: row.title, source: row.source };
}

function getImages(type) {
  if (type === 'both') {
    const dogs = cache.get('dogs')?.data?.length > 0 ? cache.get('dogs').data : getByType('dogs', 1000).map(dbRow);
    const cats = cache.get('cats')?.data?.length > 0 ? cache.get('cats').data : getByType('cats', 1000).map(dbRow);
    const combined = [...dogs, ...cats];
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
    return combined;
  }

  const entry = cache.get(type);
  if (entry?.data?.length > 0) return entry.data;
  return getByType(type, 1000).map(dbRow);
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// Append ImageCodex on-the-fly transform params for mobile delivery.
// Resize to 600px wide, convert to WebP, quality 80.
// Raw URL is kept in DB; transform is applied only at serve time.
const MOBILE_TRANSFORM = 'w=600,format=webp,q=80';
function mobileUrl(icUrl) { return `${icUrl}/${MOBILE_TRANSFORM}`; }

// GET /api/images?type=dogs|cats|both
app.get('/api/images', (req, res) => {
  const { type } = req.query;
  if (!['dogs', 'cats', 'both'].includes(type)) {
    return res.status(400).json({ error: 'type must be dogs, cats, or both' });
  }
  try {
    const images = getImages(type).map((img) => ({ ...img, url: mobileUrl(img.url) }));
    res.json(images);
  } catch (err) {
    console.error('Failed to get images:', err.message);
    res.status(502).json({ error: 'Could not fetch images right now' });
  }
});

// POST /api/like   { ic_id }
app.post('/api/like', (req, res) => {
  const { ic_id } = req.body;
  if (!ic_id || typeof ic_id !== 'string') {
    return res.status(400).json({ error: 'ic_id required' });
  }
  const updated = incrementLikes(ic_id);
  if (!updated) return res.status(404).json({ error: 'Image not found' });
  res.json({ ok: true });
});

// POST /api/superlike   { ic_id }
app.post('/api/superlike', (req, res) => {
  const { ic_id } = req.body;
  if (!ic_id || typeof ic_id !== 'string') {
    return res.status(400).json({ error: 'ic_id required' });
  }
  const updated = incrementSuperlikes(ic_id);
  if (!updated) return res.status(404).json({ error: 'Image not found' });
  res.json({ ok: true });
});

// GET /api/top/superlikes?limit=50
app.get('/api/top/superlikes', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(getTopSuperlikes(limit));
});

// GET /api/images/:ic_id  (single image stats)
app.get('/api/images/:ic_id', (req, res) => {
  const record = getById(req.params.ic_id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Dogs & Cats running at http://localhost:${PORT}`);
  startFetchLoop().catch(console.error);
});
