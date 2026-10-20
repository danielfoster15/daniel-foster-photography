// The deployed site: shared files, one page per gallery, and a local preview server.

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const zips = shoot.zips ?? [];
  if (!config.r2PublicUrl || zips.length === 0 || !zips.every((z) => z.uploaded)) return "";
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

export function galleryHtml(shoot, config) {
  const n = shoot.photos.length;
  const meta = [shoot.date, `${n} photo${n === 1 ? "" : "s"}`].filter(Boolean).map(esc).join(" · ");
  const base = `/${shoot.slug}`;
  const tiles = shoot.photos.map((p, i) => {
    const label = `Photo ${i + 1} of ${n}`;
    const view = p.large ? `${base}/large/${p.file}` : `${base}/photos/${p.file}`;
    const download = `${base}/photos/${p.file}`;
    return `    <figure class="tile" style="--r:${(p.tw / p.th).toFixed(4)}">
      <a class="photo" href="${esc(view)}" data-pswp-width="${p.lw}" data-pswp-height="${p.lh}" data-download="${esc(download)}" data-filename="${esc(p.file)}">
        <img src="${esc(`${base}/thumbs/${p.file}`)}" width="${p.tw}" height="${p.th}" alt="${label}"${i < 12 ? "" : ' loading="lazy"'} decoding="async" />
      </a>
      <a class="save" href="${esc(download)}" download="${esc(p.file)}" aria-label="Download ${label.toLowerCase()}">${DOWNLOAD_ICON}</a>
    </figure>`;
  });
  return `${head(shoot.title, config)}
<body>
  <header class="top">
    <a class="brand" href="${esc(config.mainSiteUrl)}">${esc(config.siteName)}</a>
    <h1>${esc(shoot.title)}</h1>
    <p class="meta">${meta}</p>${downloadsHtml(shoot, config)}
    <p class="hint">Click or tap a photo to see it full screen. The arrow button downloads the full-size file.</p>
  </header>
  <main class="grid">
${tiles.join("\n")}
  </main>
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
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      res.end(await fs.readFile(path.join(root, "404.html")).catch(() => "Not found"));
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
