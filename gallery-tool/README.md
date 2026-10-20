# Client galleries

Turns a zip of edited JPGs into a gallery page you can send to a client. The page looks like
danielfosterphotography.nl: black background, white text, the LT Remark font. It has:

- a grid of every photo, uncropped, in the order you exported them
- a full-screen viewer with a download button for the full-size file
- a download button on every photo
- a **Download all** zip, split into parts when a shoot is too big for one file

Galleries are hosted on Cloudflare's free plan: **Pages** for the page and photos, **R2** for the
download-all zips. Only people with the link find a gallery. Its address ends in a random code
(like `/phantom-four-k8x2q9/`), it isn't linked from anywhere, and it tells search engines not to
list it.

Your photos never go into this repository, because the repository is public. Everything is kept in
a `client-galleries` folder in your home folder and uploaded straight to Cloudflare.

## One-time setup (about 15 minutes)

1. **Install Node.js 22 or newer** from [nodejs.org](https://nodejs.org) (the LTS version). To check
   which version you have, open Terminal and run `node --version`.
2. **Install the tool.** In Terminal, go to this folder and run:
   ```sh
   cd path/to/daniel-foster-photography/gallery-tool
   npm install
   ```
3. **Make a free Cloudflare account** at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
4. **Turn on R2** (needed for the Download all button). In the Cloudflare dashboard, open
   *R2 Object Storage* and follow the steps. Cloudflare asks for a card, but the first 10 GB are
   free and downloads cost nothing. You can skip this step and add it later.
5. **Run setup:**
   ```sh
   node gallery.mjs setup
   ```
   A browser window opens: log in to Cloudflare and click *Allow*. Setup then creates the site and
   the storage, and prints the address your galleries will be at.

## For each shoot

1. Export the edited JPGs from Lightroom and zip them. A folder of JPGs also works.
2. Make the gallery:
   ```sh
   node gallery.mjs new ~/Downloads/phantom-four.zip --title "Phantom Four" --date "11 October 2026"
   ```
   The photos are renamed `phantom-four-001.jpg`, `phantom-four-002.jpg` and so on. To keep your own
   file names, add `--keep-names`. The date is optional and can be written however you like.
3. Look at it on your computer first (optional):
   ```sh
   node gallery.mjs preview
   ```
   Open the link it prints. Press Ctrl+C when you're done.
4. Put it online:
   ```sh
   node gallery.mjs deploy
   ```
   This uploads the gallery and the download-all zip, then prints the link to send. Each new
   gallery only uploads its own files, so galleries already online aren't sent again.

## Other commands

| Command | What it does |
| --- | --- |
| `node gallery.mjs list` | Shows every gallery with its link. |
| `node gallery.mjs remove <name>` | Takes a gallery offline and deletes your computer's copy. Your original zip isn't touched. The names are in `list`. |
| `node gallery.mjs help` | Shows all the commands. |

## Good to know

- **Who can see a gallery:** anyone with the link. If you need a real login, Cloudflare Access
  (in the dashboard under *Zero Trust*, free for up to 50 people) can ask visitors for an emailed
  code before showing the page.
- **Free-plan limits:**
  - A Cloudflare Pages site holds up to 20,000 files. Each photo uses 2–3 files, so you can have
    about 20 shoots of 300 photos online at once. `deploy` tells you when you're over; remove old
    galleries to make room.
  - Each photo must be under 25 MB. Bigger files are re-saved at slightly lower quality, and `new`
    lists which ones.
  - R2 holds 10 GB of zips for free.
- **Taking a gallery down:** `remove` deletes the page and its zips. Cloudflare also keeps every
  past upload at its own hidden address (like `https://1a2b3c4d.danielfoster-galleries.pages.dev`).
  To delete those too, open the project in the dashboard under *Workers & Pages* → *Deployments*.
- **Zip downloads** use R2's `r2.dev` address. Cloudflare limits how fast that address serves files
  and says it's meant for testing. It's fine for sending zips to a few clients. For heavier use,
  connect your own domain to the bucket in the dashboard.
- **Your own address:** to use something like `galleries.danielfosterphotography.nl`, add it in the
  dashboard (*Workers & Pages* → your project → *Custom domains*). Then set `siteUrl` in
  `~/client-galleries/config.json` so the printed links use it.
- **Page text:** `siteName`, `mainSiteUrl` and the footer `credit` line are also in `config.json`.
  Run `deploy` after changing them.
- **Different folder:** set `GALLERY_HOME` to keep galleries somewhere other than
  `~/client-galleries`.
- **Credits:** the viewer is [PhotoSwipe](https://photoswipe.com) (MIT licence, copied with its
  licence into each upload). The font is LT Remark (SIL Open Font License, see `../fonts/README.md`).
- **Tests:** `npm test`.
