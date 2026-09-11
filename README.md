# Site Survey Mapper

Offline-first site survey capture tool for Age of Aquarius India Developers
LLP's site engineers, built for fieldwork in Purandar Taluka, Pune District,
Maharashtra. It's a static, no-build single-page app that stores everything
locally (IndexedDB) first, then syncs to a Google Sheet + Drive backend via a
Google Apps Script Web App whenever the device has signal.

## What it captures

- **Field check-in** — every time the app opens, the engineer must take a
  live front-camera photo (no file picker — camera stream only) and enter
  their name before the app is usable; the device's current GPS fix is
  captured silently in the background at the same time. Not dismissible.
- **Work items** at an exact GPS coordinate, with type-specific fields:
  fencing, road (width/type: rocky, asphalt, concrete), pipeline (plastic
  0.5"–6" or cement, inches + mm), well digging (square/rectangle/circle,
  dimensions + depth), excavation (base type — see geology notes below —
  plus dimensions/depth), resurfacing/re-layering.
- **Geo-tagged photos** — reads GPS + capture time straight out of the
  photo's EXIF data (falls back to live device GPS if the photo has none).
- **Geo-tagged videos** — tagged with the device's live GPS at capture time.
- **DJI Air 3 drone flights** — parses the drone's `.SRT` telemetry sidecar
  (per-frame lat/lon/altitude/ISO/shutter/etc.) into a flight-path polyline,
  bounding box, and altitude/duration summary. The `.MP4`/`.LRF` files are too
  large to push through Apps Script reliably, so the app records their
  filename and a Drive link you paste in after uploading them yourself (see
  *Handling drone video files* below).

This app is a **capture and cataloguing tool**, not a photogrammetry engine.
It organizes geo-tagged imagery/video/flight metadata so it's ready to feed
into dedicated photogrammetry software (Pix4D, Agisoft Metashape, WebODM,
RealityCapture) to actually produce the 3D model / contour map.

## Regional geology reference

Purandar Taluka sits on the Deccan Trap basalt plateau. The Excavation
form's "base type" dropdown is built around what a site engineer will
actually encounter there: agricultural black cotton soil (regur) in
valley/plateau farmland, shallower orange/lateritic soil on slopes, murum
(weathered basalt gravel) as a sub-base layer, and hard rock as Black
Basalt or the locally-traded "Green Manjri" / "Red Manjri" trap stone
variants. Full notes are shown as an expandable note inside the Excavation
form.

---

## 1. Set up the Google Sheet + Apps Script backend

1. Create a new Google Sheet (e.g. "Site Survey Mapper — Data"). Tabs are
   created automatically on first run — you don't need to add them by hand.
2. In the Sheet, go to **Extensions > Apps Script**.
3. Delete the default `Code.gs` content and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this project.
4. In `setup()`, change `TOKEN` to a long random string (this is the shared
   secret the app uses to authenticate — treat it like a password).
5. Run `setup()` once (select it in the function dropdown, click ▶ Run).
   Approve the permission prompts (Sheets + Drive access). Check
   **View > Logs** for the token and Drive folder URL it created.
6. **Deploy > New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone with the link**
   - Click Deploy, authorize again if prompted, and copy the **Web app URL**
     (ends in `/exec`).

Keep this Web app URL and token handy for step 2 — site engineers themselves
never need to enter them anywhere.

## 2. Host the SPA (GitHub Pages via Actions)

No build step for the app itself — it's static HTML/CSS/JS. This repo
deploys via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which injects the backend URL/token from **GitHub Actions secrets and
variables** at deploy time, so neither ever sits in source control:

1. In the GitHub repo, go to **Settings > Secrets and variables > Actions**.
2. Under **Variables**, add `SSM_WEB_APP_URL` = the Apps Script `/exec` URL
   from step 1 (not sensitive by itself, but keeping it alongside the token
   avoids drift between them).
3. Under **Secrets**, add `SSM_TOKEN` = the token you set in `setup()`.
4. In **Settings > Pages**, set **Source** to **GitHub Actions** (not
   "Deploy from a branch").
5. Push to `main` (or run the workflow manually from the **Actions** tab) —
   the workflow substitutes both values into `js/sheets-api.js` at build
   time, then publishes the result to Pages. The source file committed to
   the repo only ever contains the placeholders `__SSM_WEB_APP_URL__` and
   `__SSM_TOKEN__`.

Other static hosts (Netlify, Vercel, etc.) work too — just replicate the
same "substitute placeholders from the platform's secret store, then
publish" step in their build pipeline instead.

Once loaded once, the app shell (HTML/CSS/JS/map library) is cached by the
service worker, so the form and map still work with no signal at all — only
the final sync step needs connectivity.

For real field use, open the hosted URL on the engineer's phone and use
**"Add to Home Screen"** (Safari/Chrome share menu) — it installs as a
standalone app icon via the PWA manifest.

### Local development

Since `js/sheets-api.js` only contains placeholders, sync calls will fail
against a plain local checkout. Point it at your real backend for local
testing via the browser console (persists in that browser's `localStorage`,
never touches the source file):

```js
setConfig({ ...getConfig(), webAppUrl: "https://script.google.com/.../exec", token: "your-token" });
```

## 3. Check in

The app opens straight into a **Field Check-In** screen every time it's
launched: it asks for the engineer's name and a live front-camera photo
(no photo library picker — it must be a fresh camera capture), while
quietly grabbing a current GPS fix in the background. Both the name and
the photo are required; there's no way to skip it. Tapping the logo in the
header re-opens this screen later (e.g. to re-check-in as a different
engineer on a shared device).

## 4. Using it in the field

- **+ New > Work Item** — capture GPS (or type it in), pick the work type,
  fill in the type-specific fields, save. It queues locally and syncs
  automatically when online (a badge on the **Sync** tab in the bottom nav
  shows the pending count).
- **+ New > Photo** — take/choose a photo; GPS is read from its EXIF data
  automatically.
- **+ New > Video** — take/choose a video; tagged with live device GPS.
  Videos over 15MB skip auto-upload and instead prompt for a Drive link you
  paste in after uploading manually (see below).
- **+ New > Drone Flight** — select the DJI Air 3's `.SRT` file for the
  flight. The app parses it instantly and shows frame count, duration, and
  altitude range, then draws the flight path on the map.
- **Map tab** — satellite imagery (Esri World Imagery, with a road/place
  label overlay) rather than a street map, so pins line up with what's
  actually on the ground.
- **Sync tab** — see what's pending, retry failed items, or force a manual
  sync.

### Handling drone video files

A DJI Air 3 flight video is commonly 200–400MB+. Apps Script Web Apps aren't
a reliable path for files that large (request size and execution-time
limits). The workflow this app uses instead:

1. Import the `.SRT` (a few hundred KB — this uploads automatically and is
   parsed for the flight-path summary).
2. Upload the matching `.MP4` to the Drive folder Apps Script created (see
   the `setup()` log, or Settings) using the Drive app/website directly, or
   hand it off on a laptop with better bandwidth.
3. Paste the resulting Drive share link into the Drone Flight form's
   **Video Drive link** field before saving — it's stored alongside the
   flight-path metadata in the `DroneFlights` sheet tab.

The `.LRF` file DJI writes alongside the video is its own low-resolution
preview proxy (used by the DJI Fly app for quick playback) — it isn't
needed for photogrammetry or for this workflow and can be left off Drive.

## Data model (Google Sheet tabs)

- **Logins** — id, timestamps, engineer/project, GPS fix (lat/lon/accuracy),
  Drive link to the check-in selfie. One row per app open.
- **WorkItems** — id, timestamps, engineer/project, work type, lat/lon,
  type-specific fields (as JSON), notes.
- **Media** — id, timestamps, engineer/project, media type, lat/lon, Drive
  link, optional linked work item, notes.
- **DroneFlights** — id, timestamps, engineer/project, frame count,
  duration, start/end position, bounding box, altitude stats, simplified
  flight path (JSON polyline, ≤300 points), SRT/MP4 filenames and Drive
  links, notes.

## Known limitations

- Check-in needs the browser's camera and location permissions granted (and
  HTTPS, which GitHub Pages already provides); if the engineer denies camera
  access there's no fallback — by design, since the point is proof a live
  person is present, not an uploaded photo.
- The shared-token auth in Apps Script is lightweight (a single pre-shared
  secret), appropriate for a small internal team — not enterprise-grade
  access control.
- Large video auto-upload is capped at 15MB; anything bigger needs the
  manual Drive-link step above.
- No in-browser 3D reconstruction — by design, this app prepares data for
  external photogrammetry software rather than attempting structure-from-
  motion itself.
