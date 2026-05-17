/**
 * Dogs & Cats — Tinder-style swipe frontend
 *
 * Reactions:  swipe right = like | swipe up / ⭐ button = superlike | swipe left = scolded
 * Bookmarks:  superlikes saved to localStorage + shown in the bookmarks panel
 * Server:     like / superlike counts sent to /api/like and /api/superlike
 */

// ── Scolding messages ─────────────────────────────────────────────────────────
const SCOLD_MESSAGES = [
  "This precious angel did NOTHING wrong. Reconsider your life choices. 😤",
  "Excuse me?! That is literally the cutest thing on Earth and you swiped LEFT?! 🫢",
  "ERROR 404: Valid reason to dislike this cutie not found. 🤖",
  "The Council of Fluffs has been notified of your crimes. 🚨",
  "Your heart is clearly 3 sizes too small today. ❄️",
  "The audacity. The sheer, unmitigated audacity. 😠",
  "I am calling the Cute Animal Protection Agency right now. ☎️",
  "Scientists baffled: local user tries to dislike undeniably perfect creature. 📰",
  "This baby is literally perfect and you swiped LEFT?! Absolutely unacceptable! 😱",
  "Left swipes on cute animals are banned in 47 countries. You've been warned. 🚫",
];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screenSelect      = document.getElementById('screen-select');
const screenLoading     = document.getElementById('screen-loading');
const screenSwipe       = document.getElementById('screen-swipe');
const loadingText       = document.getElementById('loading-text');
const cardStack         = document.getElementById('card-stack');
const errorModal        = document.getElementById('error-modal');
const modalMessage      = document.getElementById('modal-message');
const btnModalClose     = document.getElementById('btn-modal-close');
const btnBack           = document.getElementById('btn-back');
const btnNope           = document.getElementById('btn-nope');
const btnLike           = document.getElementById('btn-like');
const btnSuperlike      = document.getElementById('btn-superlike');
const btnBookmarks      = document.getElementById('btn-bookmarks');
const bookmarksPanel    = document.getElementById('bookmarks-panel');
const btnBookmarksClose = document.getElementById('btn-bookmarks-close');
const bookmarksGrid     = document.getElementById('bookmarks-grid');

// ── State ─────────────────────────────────────────────────────────────────────
let images       = [];
let currentIndex = 0;
const STACK_DEPTH    = 3;
const SWIPE_THRESHOLD = 70;

// ── Bookmarks (localStorage) ──────────────────────────────────────────────────
const BOOKMARKS_KEY = 'dogsandcats_superlikes';

function getBookmarks() {
  try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]'); }
  catch { return []; }
}

function addBookmark(img) {
  const list = getBookmarks();
  if (list.some((b) => b.ic_id === img.ic_id)) return;
  list.unshift({ ic_id: img.ic_id, url: img.url, title: img.title, source: img.source, saved_at: Date.now() });
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
}

// ── Server reactions (fire-and-forget) ───────────────────────────────────────
function sendReaction(ic_id, action) {
  fetch(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ic_id }),
  }).catch(() => {});
}

// ── Screen transitions ────────────────────────────────────────────────────────
function showScreen(screen) {
  [screenSelect, screenLoading, screenSwipe].forEach((s) => s.classList.remove('active'));
  screen.classList.add('active');
}

// ── Selection ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.choice-btn').forEach((btn) => {
  btn.addEventListener('click', () => start(btn.dataset.type));
});

// ── Back ──────────────────────────────────────────────────────────────────────
btnBack.addEventListener('click', () => {
  images = []; currentIndex = 0; cardStack.innerHTML = '';
  showScreen(screenSelect);
});

// ── Error modal ───────────────────────────────────────────────────────────────
btnModalClose.addEventListener('click', () => errorModal.classList.add('hidden'));

// ── Bookmarks panel ───────────────────────────────────────────────────────────
btnBookmarks.addEventListener('click', () => {
  renderBookmarks();
  bookmarksPanel.classList.remove('hidden');
});

btnBookmarksClose.addEventListener('click', () => bookmarksPanel.classList.add('hidden'));

function renderBookmarks() {
  const list = getBookmarks();
  bookmarksGrid.innerHTML = '';
  if (list.length === 0) {
    bookmarksGrid.innerHTML = `
      <div class="bookmarks-empty">
        <div class="empty-emoji">⭐</div>
        <p>No superlikes yet!<br>Swipe up or tap ⭐ to save your favourites.</p>
      </div>`;
    return;
  }
  list.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'bookmark-item';
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.title || 'Superliked animal';
    img.loading = 'lazy';
    const src = document.createElement('div');
    src.className = 'bookmark-source';
    src.textContent = item.source || '';
    div.appendChild(img);
    div.appendChild(src);
    bookmarksGrid.appendChild(div);
  });
}

// ── Preloader ─────────────────────────────────────────────────────────────────
function preload(imgs, count = 6) {
  imgs.slice(0, count).forEach((img) => { new Image().src = img.url; });
}

// ── Start flow ────────────────────────────────────────────────────────────────
function showSkeleton() {
  cardStack.innerHTML = '<div class="card card--skeleton"></div>';
}

function showEndCard(emoji, title, body, onRetry) {
  cardStack.innerHTML = `
    <div class="end-card">
      <div class="end-emoji">${emoji}</div>
      <h2>${title}</h2>
      <p>${body}</p>
      ${onRetry ? '<button class="btn-restart">Try again</button>' : ''}
    </div>`;
  if (onRetry) cardStack.querySelector('.btn-restart').addEventListener('click', onRetry, { once: true });
}

async function start(type) {
  images = []; currentIndex = 0;
  showScreen(screenSwipe);
  showSkeleton();

  let list;
  try {
    const res = await fetch(`/api/images?type=${encodeURIComponent(type)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
  } catch {
    showEndCard('😿', 'Could not reach server', 'Check your connection and try again.', () => start(type));
    return;
  }

  if (!Array.isArray(list) || list.length === 0) {
    showEndCard('🐾', 'Still loading cuties…', 'The server is warming up. Tap to check again.', () => start(type));
    return;
  }

  images = list;
  currentIndex = 0;
  preload(images);
  renderStack();
}

// ── Card stack ────────────────────────────────────────────────────────────────
function renderStack() {
  cardStack.innerHTML = '';
  const end = Math.min(currentIndex + STACK_DEPTH, images.length);
  for (let i = end - 1; i >= currentIndex; i--) {
    const offset = i - currentIndex;
    const card   = buildCard(images[i], offset === 0);
    applyStackTransform(card, offset);
    cardStack.appendChild(card);
  }
}

function applyStackTransform(card, offset) {
  card.style.transform  = `translateY(${offset * 10}px) scale(${1 - offset * 0.04})`;
  card.style.zIndex     = 10 - offset;
  card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
}

// ── Build card ────────────────────────────────────────────────────────────────
function buildCard(imageData, isTop) {
  const card = document.createElement('div');
  card.className = 'card' + (isTop ? '' : ' card--background');

  // Blurred background fill — makes landscape images look great in portrait cards
  const bg = document.createElement('div');
  bg.className = 'card-blur-bg';
  bg.style.backgroundImage = `url(${imageData.url})`;

  const img = document.createElement('img');
  img.alt = imageData.title || 'Cute animal';
  img.style.opacity = '0';
  img.style.transition = 'opacity 0.25s ease';
  img.onload  = () => { img.style.opacity = '1'; bg.style.opacity = '1'; };
  img.onerror = () => { img.style.opacity = '0.15'; };
  img.src = imageData.url;

  const info = document.createElement('div');
  info.className = 'card-info';
  const t = document.createElement('p'); t.className = 'card-title';   t.textContent = imageData.title  || '';
  const s = document.createElement('p'); s.className = 'card-source';  s.textContent = imageData.source || '';
  info.appendChild(t); info.appendChild(s);

  const labelLike  = document.createElement('div'); labelLike.className  = 'card-label label-like';  labelLike.textContent  = 'CUTE!';
  const labelNope  = document.createElement('div'); labelNope.className  = 'card-label label-nope';  labelNope.textContent  = 'NOPE';
  const labelSuper = document.createElement('div'); labelSuper.className = 'card-label label-super'; labelSuper.textContent = '⭐ SUPER!';

  card.appendChild(bg);
  card.appendChild(img);
  card.appendChild(info);
  card.appendChild(labelLike);
  card.appendChild(labelNope);
  card.appendChild(labelSuper);

  if (isTop) attachDrag(card, labelLike, labelNope, labelSuper);

  return card;
}

// ── Drag / swipe ──────────────────────────────────────────────────────────────
function attachDrag(card, labelLike, labelNope, labelSuper) {
  let startX = 0, startY = 0, dx = 0, dy = 0, active = false;

  function onStart(x, y) {
    active = true; startX = x; startY = y; dx = 0; dy = 0;
    card.style.transition = 'none';
  }

  function onMove(x, y) {
    if (!active) return;
    dx = x - startX;
    dy = y - startY;

    // Determine dominant direction
    const isGoingUp = dy < 0 && Math.abs(dy) > Math.abs(dx) * 0.7;
    if (isGoingUp) {
      card.style.transform = `translate(${dx * 0.3}px, ${dy}px) scale(${1 + Math.min(Math.abs(dy) / 400, 0.08)})`;
      const ratio = Math.min(Math.abs(dy) / SWIPE_THRESHOLD, 1);
      labelSuper.style.opacity = ratio;
      labelLike.style.opacity  = 0;
      labelNope.style.opacity  = 0;
      btnSuperlike.style.transform = `scale(${1 + ratio * 0.45})`;
      btnLike.style.transform      = 'scale(1)';
      btnNope.style.transform      = 'scale(1)';
    } else {
      const rot = dx * 0.07;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
      const ratio = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      if (dx > 0) {
        labelLike.style.opacity  = ratio; labelNope.style.opacity  = 0;
        btnLike.style.transform      = `scale(${1 + ratio * 0.45})`;
        btnNope.style.transform      = 'scale(1)';
      } else {
        labelNope.style.opacity  = ratio; labelLike.style.opacity  = 0;
        btnNope.style.transform      = `scale(${1 + ratio * 0.45})`;
        btnLike.style.transform      = 'scale(1)';
      }
      labelSuper.style.opacity     = 0;
      btnSuperlike.style.transform = 'scale(1)';
    }
  }

  function onEnd() {
    if (!active) return;
    active = false;
    labelLike.style.opacity = labelNope.style.opacity = labelSuper.style.opacity = 0;
    btnLike.style.transform = btnNope.style.transform = btnSuperlike.style.transform = 'scale(1)';

    const isUp = dy < -SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx);

    if (isUp) {
      doSuperlike(card);
    } else if (dx > SWIPE_THRESHOLD) {
      doLike(card);
    } else if (dx < -SWIPE_THRESHOLD) {
      snapBack(card); showScoldModal();
    } else {
      snapBack(card);
    }
  }

  // Touch
  card.addEventListener('touchstart', (e) => { const t = e.touches[0]; onStart(t.clientX, t.clientY); }, { passive: true });
  card.addEventListener('touchmove',  (e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY);  }, { passive: true });
  card.addEventListener('touchend',    onEnd);
  card.addEventListener('touchcancel', onEnd);

  // Mouse
  card.addEventListener('mousedown', (e) => { onStart(e.clientX, e.clientY); e.preventDefault(); });
  const onMM = (e) => onMove(e.clientX, e.clientY);
  const onMU = () => { if (active) onEnd(); };
  document.addEventListener('mousemove', onMM);
  document.addEventListener('mouseup',   onMU);

  const obs = new MutationObserver(() => {
    if (!card.isConnected) {
      document.removeEventListener('mousemove', onMM);
      document.removeEventListener('mouseup',   onMU);
      obs.disconnect();
    }
  });
  obs.observe(cardStack, { childList: true });
}

// ── Superlike button ──────────────────────────────────────────────────────────
btnNope.addEventListener('click', () => {
  const topCard = cardStack.querySelector('.card:not(.card--background)');
  if (topCard) doNope(topCard);
});

btnLike.addEventListener('click', () => {
  const topCard = cardStack.querySelector('.card:not(.card--background)');
  if (topCard) doLike(topCard);
});

btnSuperlike.addEventListener('click', () => {
  const topCard = cardStack.querySelector('.card:not(.card--background)');
  if (topCard) doSuperlike(topCard);
});

// ── Actions ───────────────────────────────────────────────────────────────────
function doNope(card) {
  flyCard(card, -1);
}

function doLike(card) {
  const img = images[currentIndex];
  sendReaction(img.ic_id, 'like');
  flyCard(card, 1);
}

function doSuperlike(card) {
  const img = images[currentIndex];
  sendReaction(img.ic_id, 'superlike');
  addBookmark(img);
  spawnStars(card);
  flyCardUp(card);
}

function spawnStars(card) {
  const rect = card.getBoundingClientRect();
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;
  const GLYPHS = ['⭐','✨','💛','⭐','✨','🌟','⭐','✨','💫'];
  const COUNT  = 22;
  for (let i = 0; i < COUNT; i++) {
    const el = document.createElement('span');
    el.className = 'star-particle';
    el.textContent = GLYPHS[i % GLYPHS.length];
    const angle = (i / COUNT) * 2 * Math.PI + (Math.random() - 0.5) * 0.5;
    const dist  = 80 + Math.random() * 180;
    const tx    = Math.round(Math.cos(angle) * dist);
    const ty    = Math.round(Math.sin(angle) * dist);
    const size  = (0.9 + Math.random() * 0.9).toFixed(2);
    const dur   = (0.55 + Math.random() * 0.5).toFixed(2);
    const delay = (Math.random() * 0.12).toFixed(2);
    el.style.cssText = `left:${cx}px;top:${cy}px;transform-origin:center;
      --tx:${tx}px;--ty:${ty}px;--size:${size}rem;--dur:${dur}s;
      animation-delay:${delay}s;margin-left:-0.5em;margin-top:-0.5em;`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

function advance() {
  currentIndex++;

  if (currentIndex >= images.length) {
    showEndCard('🎉', "You've seen them all!",
      "You're a certified cute-animal appreciator!",
      () => { images = []; currentIndex = 0; cardStack.innerHTML = ''; showScreen(screenSelect); });
    return;
  }

  // Remove the outgoing top card (already off-screen from flyCard/flyCardUp)
  const outgoing = cardStack.querySelector('.card:not(.card--background)');
  if (outgoing) outgoing.remove();

  // Animate remaining background cards forward into their new positions.
  // querySelectorAll returns DOM order (lowest z-index first), so reverse to get front→back.
  const bgCards = [...cardStack.querySelectorAll('.card--background')].reverse();
  bgCards.forEach((card, i) => {
    const newOffset = i;
    card.style.transition = 'transform 0.38s cubic-bezier(.34,1.1,.64,1)';
    card.style.transform  = `translateY(${newOffset * 10}px) scale(${1 - newOffset * 0.04})`;
    card.style.zIndex     = 10 - newOffset;
    if (newOffset === 0) {
      card.classList.remove('card--background');
      card.style.cursor        = 'grab';
      card.style.pointerEvents = 'auto';
      const ll = card.querySelector('.label-like');
      const ln = card.querySelector('.label-nope');
      const ls = card.querySelector('.label-super');
      if (ll && ln && ls) attachDrag(card, ll, ln, ls);
    }
  });

  // Append a fresh card at the back of the stack
  const newIdx = currentIndex + bgCards.length;
  if (newIdx < images.length) {
    const newCard = buildCard(images[newIdx], false);
    applyStackTransform(newCard, bgCards.length);
    cardStack.insertBefore(newCard, cardStack.firstChild);
  }

  preload(images.slice(currentIndex + STACK_DEPTH, currentIndex + STACK_DEPTH + 4));
}

// ── Animations ────────────────────────────────────────────────────────────────
function flyCard(card, direction) {
  card.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
  card.style.transform  = `translate(${direction * 160}vw, -60px) rotate(${direction * 30}deg)`;
  card.style.opacity    = '0';
  setTimeout(advance, 380);
}

function flyCardUp(card) {
  card.classList.add('card--superlike-fly');
  setTimeout(advance, 520);
}

function snapBack(card) {
  card.classList.remove('card--shake');
  void card.offsetWidth;
  card.classList.add('card--shake');
  card.style.transition = '';
  card.addEventListener('animationend', () => {
    card.classList.remove('card--shake');
    applyStackTransform(card, 0);
  }, { once: true });
}

// ── Scold modal ───────────────────────────────────────────────────────────────
function showScoldModal() {
  modalMessage.textContent = SCOLD_MESSAGES[Math.floor(Math.random() * SCOLD_MESSAGES.length)];
  errorModal.classList.remove('hidden');
}
