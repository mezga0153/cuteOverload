/**
 * imagecodex.js — Download from source URL and upload to ImageCodex.
 *
 * Combines availability validation + permanent hosting in one step:
 * if the source URL is unreachable or the upload fails, returns null.
 */

import { getBySourceUrl, insertImage } from './db.js';

const BASE_URL = 'https://imagecodex.com';

function getConfig() {
  const key  = process.env.IMAGECODEX_API_KEY;
  const site = process.env.IMAGECODEX_SITE_ID;
  if (!key || !site) throw new Error('Missing IMAGECODEX_API_KEY or IMAGECODEX_SITE_ID in environment');
  return { key, site };
}

/**
 * Uploads a Buffer to ImageCodex.
 * @returns {Promise<{id, link}|null>}
 */
async function uploadBuffer(buffer, filename, mimeType, folder) {
  const { key, site } = getConfig();
  const form = new FormData();
  form.append('files', new Blob([buffer], { type: mimeType }), filename);
  form.append('folder', folder);

  const res = await fetch(`${BASE_URL}/v1/sites/${site}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.warn(`[imagecodex] upload failed ${res.status}: ${txt}`);
    return null;
  }

  const [asset] = await res.json();
  return asset ?? null;
}

/**
 * Given an image object from the Reddit scraper, ensures it exists on
 * ImageCodex (downloading + uploading if not already cached in the DB).
 *
 * @param {{ url, title, source }} img   - raw image from Reddit
 * @param {'dogs'|'cats'|'both'} type   - used for the ImageCodex folder
 * @returns {Promise<{ic_id, url, title, source}|null>}
 */
export async function ensureHosted(img, type) {
  // 1. Already in DB — return cached record immediately
  const existing = getBySourceUrl(img.url);
  if (existing) {
    return {
      ic_id: existing.ic_id,
      url:   existing.ic_url,
      title: existing.title,
      source: existing.source,
    };
  }

  // 2. Download from source
  let response;
  try {
    response = await fetch(img.url, {
      headers: { 'User-Agent': 'DogsAndCatsApp/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const mimeType = response.headers.get('content-type') ?? '';
  if (!mimeType.startsWith('image/')) return null;

  let buffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    return null;
  }

  if (!buffer.byteLength) return null;

  // 3. Upload to ImageCodex
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg').split(';')[0] ?? 'jpg';
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const folder   = `/${type}/`;

  const asset = await uploadBuffer(Buffer.from(buffer), filename, mimeType, folder);
  if (!asset) return null;

  // 4. Persist to DB
  const { site } = getConfig();
  const icUrl = `${BASE_URL}/v1/${site}/media/${asset.link}`;
  insertImage({
    ic_id:      asset.id,
    ic_link:    asset.link,
    ic_url:     icUrl,
    type,
    source_url: img.url,
    title:      img.title ?? '',
    source:     img.source ?? '',
  });

  return {
    ic_id:  asset.id,
    url:    icUrl,
    title:  img.title ?? '',
    source: img.source ?? '',
  };
}
