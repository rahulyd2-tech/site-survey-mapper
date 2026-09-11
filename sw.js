// App-shell cache so the survey form still works with no signal in the field.
// Data itself is queued in IndexedDB (see js/db.js) and synced separately.

const CACHE_NAME = "ssm-shell-v5";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./assets/logo-aoa.png",
  "./js/geology.js",
  "./js/work-item-schema.js",
  "./js/db.js",
  "./js/exif.js",
  "./js/srt-parser.js",
  "./js/sheets-api.js",
  "./js/map.js",
  "./js/app.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache Apps Script API calls or map tile requests — those need live network.
  if (url.hostname.includes("script.google.com") || url.hostname.includes("tile.openstreetmap.org")) {
    return;
  }

  // Network-first: always prefer a fresh copy so app updates aren't stuck
  // behind a stale cache, but fall back to cache when there's no signal.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
