# 🐾 Cute Overload

A Tinder-style swipe app for people who have their priorities straight.

Swipe right on dogs. Swipe right on cats. Try to swipe left — we dare you.

## What it does

- Pulls the freshest cute animal pics from Reddit
- Uploads them permanently to [ImageCodex](https://imagecodex.com) so they never disappear on you
- Serves them mobile-optimised (WebP, 600px, quality 80 — your data plan will thank you)
- Tracks likes and superlikes in a local SQLite database because some cuties deserve to be remembered
- Lets you ⭐ superlike your favourites and bookmark them for later (for when you need emotional support)
- Scolds you if you dare swipe left

## The rules

| Gesture | Result |
|---|---|
| Swipe right | ❤️ Like |
| Swipe up / tap ⭐ | ⭐ Superlike (saved to bookmarks) |
| Swipe left | 🚨 Immediate moral judgement |

## Running it

```bash
cp .env.example .env
# fill in your ImageCodex API key and site ID
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) and get nothing done for the rest of the day.

## How it works

On startup the server quietly fetches and uploads a fresh batch of dogs and cats to ImageCodex in the background. By the time you've picked a category, the images are ready. No waiting, no spinners, just cuties.

Previously uploaded images are cached in a local SQLite database so restarts are instant and Reddit isn't hammered.

## Stack

- **Node.js + Express** — serves the API and static files
- **Reddit JSON API** — source of infinite cuteness (no auth required)
- **ImageCodex** — permanent image hosting with on-the-fly transforms
- **SQLite (better-sqlite3)** — tracks every like, superlike, and image ever seen
- **Vanilla JS + CSS** — no frameworks were harmed in the making of this UI

## Environment variables

| Variable | Description |
|---|---|
| `IMAGECODEX_API_KEY` | Your ImageCodex API key |
| `IMAGECODEX_SITE_ID` | Your ImageCodex site ID |
| `PORT` | Port to listen on (default: 3000) |

## Docker

```bash
docker compose up
```

---

*No animals were disliked in the testing of this application.*
