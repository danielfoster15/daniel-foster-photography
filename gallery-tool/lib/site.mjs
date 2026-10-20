// The deployed site: shared files, one page per gallery, and a local preview server.

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipsOnline } from "./workspace.mjs";

const toolDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoDir = path.dirname(toolDir);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

const DOWNLOAD_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>';

function head(title, config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
  <title>${esc(title)} · ${esc(config.siteName)}</title>
  <link rel="icon" href="/favicon.ico" />
  <link rel="stylesheet" href="/assets/photoswipe/photoswipe.css" />
  <link rel="stylesheet" href="/assets/gallery.css" />
</head>`;
}

function notice(title, message, config) {
  return `${head(title, config)}
<body>
  <main class="notice">
    <a class="brand" href="${esc(config.mainSiteUrl)}">${esc(config.siteName)}</a>
    <p>${message}</p>
  </main>
</body>
</html>
`;
}

// Copies the files every gallery shares and writes the root and 404 pages.
// The 404 page matters: without one, Cloudflare Pages serves the root page
// for every unknown address.
export async function writeShared(siteDir, config) {
  const assets = path.join(siteDir, "assets");
  const pswp = path.join(toolDir, "node_modules", "photoswipe");
  await fs.mkdir(path.join(assets, "photoswipe"), { recursive: true });
  await fs.mkdir(path.join(assets, "fonts"), { recursive: true });
  for (const file of ["gallery.css", "gallery.js"]) {
    await fs.copyFile(path.join(toolDir, "assets", file), path.join(assets, file));
  }
  for (const file of ["photoswipe-lightbox.esm.min.js", "photoswipe.esm.min.js", "photoswipe.css"]) {
    await fs.copyFile(path.join(pswp, "dist", file), path.join(assets, "photoswipe", file));
  }
  await fs.copyFile(path.join(pswp, "LICENSE"), path.join(assets, "photoswipe", "LICENSE"));
  for (const file of ["LTRemark-Regular.otf", "LTRemark-Bold.otf", "README.md"]) {
    await fs.copyFile(path.join(repoDir, "fonts", file), path.join(assets, "fonts", file));
  }
  await fs.copyFile(path.join(repoDir, "dist", "assets", "favicon.ico"), path.join(siteDir, "favicon.ico"));

  await fs.writeFile(
    path.join(siteDir, "_headers"),
    "/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n",
  );
  await fs.writeFile(
    path.join(siteDir, "index.html"),
    notice(config.siteName, "Client galleries. Ask Daniel for your link.", config),
  );
  await fs.writeFile(
    path.join(siteDir, "404.html"),
    notice(
      "Not found",
      "There's no gallery at this address. It may have been taken down. Ask Daniel for a new link.",
      config,
    ),
  );
}

function downloadsHtml(shoot, config) {
  if (!config.r2PublicUrl || !zipsOnline(shoot)) return "";
  const zips = shoot.zips;
  const base = config.r2PublicUrl.replace(/\/+$/, "");
  const href = (zip) => `${base}/${encodeURIComponent(shoot.slug)}/${encodeURIComponent(zip.name)}`;
  if (zips.length === 1) {
    return `
    <div class="downloads">
      <a class="button" href="${esc(href(zips[0]))}">Download all <small>(${formatBytes(zips[0].bytes)})</small></a>
    </div>`;
  }
  let first = 1;
  const buttons = zips.map((zip, i) => {
    const range = `photos ${first}–${first + zip.count - 1}`;
    first += zip.count;
    return `      <a class="button" href="${esc(href(zip))}">Part ${i + 1} <small>(${range}, ${formatBytes(zip.bytes)})</small></a>`;
  });
  return `
    <p class="parts-note">Download all, in ${zips.length} parts:</p>
    <div class="downloads">
${buttons.join("\n")}
    </div>`;
}

const ARROW_LEFT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
const ARROW_RIGHT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';

// A link that opens the photo in the full-screen viewer, wrapped around inner.
function photoLink(slug, p, inner) {
  const view = p.large ? `/${slug}/large/${p.file}` : `/${slug}/photos/${p.file}`;
  return `<a class="photo" href="${esc(view)}" data-pswp-width="${p.lw}" data-pswp-height="${p.lh}" data-download="${esc(`/${slug}/photos/${p.file}`)}" data-filename="${esc(p.file)}">${inner}</a>`;
}

// The image shown at the size of the screen: the large version, or the original if it's small.
function screenImg(slug, p, alt, lazy) {
  const src = p.large ? `/${slug}/large/${p.file}` : `/${slug}/photos/${p.file}`;
  return `<img src="${esc(src)}" width="${p.lw}" height="${p.lh}" alt="${alt}"${lazy ? ' loading="lazy"' : ""} decoding="async" />`;
}

// The page has up to three parts:
//   highlights  photos named best1.jpg, best2.jpg, ... shown large, one under the other
//   viewer      the other photos, one at a time, swiped or stepped through with arrows
//   grid        every photo as thumbnails
// The viewer and grid share a spot and a button switches between them. Without
// highlights the grid shows first, as a plain gallery.
export function galleryHtml(shoot, config) {
  const slug = shoot.slug;
  const n = shoot.photos.length;
  const number = new Map(shoot.photos.map((p, i) => [p, i + 1]));
  const label = (p) => `Photo ${number.get(p)} of ${n}`;
  const meta = [shoot.date, `${n} photo${n === 1 ? "" : "s"}`].filter(Boolean).map(esc).join(" · ");
  const best = shoot.photos.filter((p) => p.best);
  const rest = shoot.photos.filter((p) => !p.best);
  const gridFirst = best.length === 0;

  const highlights = best.map(
    (p, i) => `    ${photoLink(slug, p, screenImg(slug, p, label(p), i >= 2))}`,
  );
  const slides = rest.map(
    (p, i) => `        <li class="slide">${photoLink(slug, p, screenImg(slug, p, label(p), i >= 1))}</li>`,
  );
  const tiles = shoot.photos.map((p, i) => {
    // Thumbnails in a hidden grid would all load at once unless they're lazy.
    const lazy = !gridFirst || i >= 12;
    const thumb = `<img src="${esc(`/${slug}/thumbs/${p.file}`)}" width="${p.tw}" height="${p.th}" alt="${label(p)}"${lazy ? ' loading="lazy"' : ""} decoding="async" />`;
    return `    <figure class="tile" style="--r:${(p.tw / p.th).toFixed(4)}">
      ${photoLink(slug, p, thumb)}
      <a class="save" href="${esc(`/${slug}/photos/${p.file}`)}" download="${esc(p.file)}" aria-label="Download ${label(p).toLowerCase()}">${DOWNLOAD_ICON}</a>
    </figure>`;
  });

  let restHtml = "";
  if (rest.length > 0) {
    const viewerTitle = best.length > 0 ? `More photos · ${rest.length}` : `All photos · ${n}`;
    const gridTitle = `All photos · ${n}`;
    const first = rest[0];
    restHtml = `
  <div class="section-bar">
    <h2 data-viewer="${viewerTitle}" data-grid="${gridTitle}">${gridFirst ? gridTitle : viewerTitle}</h2>
    <button class="toggle" type="button" data-viewer="Show all in a grid" data-grid="Show one at a time">${gridFirst ? "Show one at a time" : "Show all in a grid"}</button>
  </div>
  <section class="viewer" aria-label="Photos, one at a time"${gridFirst ? " hidden" : ""}>
    <div class="stage">
      <ul class="slides" tabindex="0">
${slides.join("\n")}
      </ul>
      <button class="arrow prev" type="button" aria-label="Previous photo" disabled>${ARROW_LEFT}</button>
      <button class="arrow next" type="button" aria-label="Next photo"${rest.length === 1 ? " disabled" : ""}>${ARROW_RIGHT}</button>
    </div>
    <div class="viewer-bar">
      <span class="count" aria-live="polite">1 / ${rest.length}</span>
      <a class="save-current" href="${esc(`/${slug}/photos/${first.file}`)}" download="${esc(first.file)}">${DOWNLOAD_ICON} Download</a>
    </div>
  </section>
  <main class="grid"${gridFirst ? "" : " hidden"}>
${tiles.join("\n")}
  </main>`;
  }

  return `${head(shoot.title, config)}
<body>
  <header class="top">
    <a class="brand" href="${esc(config.mainSiteUrl)}">${esc(config.siteName)}</a>
    <h1>${esc(shoot.title)}</h1>
    <p class="meta">${meta}</p>${downloadsHtml(shoot, config)}
    <p class="hint">Click or tap any photo to see it full screen. The download buttons save the full-size file.</p>
  </header>${best.length > 0 ? `
  <section class="highlights" aria-label="Highlights">
${highlights.join("\n")}
  </section>` : ""}${restHtml}
  <footer>
    <p>${esc(config.credit)}</p>
  </footer>
  <script type="module" src="/assets/gallery.js"></script>
</body>
</html>
`;
}

export async function writeGallery(siteDir, shoot, config) {
  await fs.writeFile(path.join(siteDir, shoot.slug, "index.html"), galleryHtml(shoot, config));
}

export async function countFiles(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).length;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".otf": "font/otf",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
};

// A small static server that behaves like Cloudflare Pages for these files:
// folders serve index.html, and unknown addresses get 404.html.
export function serve(siteDir, port) {
  const root = path.resolve(siteDir);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const rel = decodeURIComponent(url.pathname);
      let file = path.resolve(root, `.${rel}`);
      if (file !== root && !file.startsWith(root + path.sep)) throw Object.assign(new Error(), { code: "ENOENT" });
      let stat = await fs.stat(file);
      if (stat.isDirectory()) {
        if (!url.pathname.endsWith("/")) {
          res.writeHead(308, { Location: `${url.pathname}/` });
          return res.end();
        }
        file = path.join(file, "index.html");
        stat = await fs.stat(file);
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      if (res.headersSent) return res.destroy();
      const body = await fs.readFile(path.join(root, "404.html")).catch(() => "Not found");
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      res.end(body);
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
