// Reading photos out of a zip or folder, making the web sizes, and packing
// the download-all zips.

import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import yauzl from "yauzl";
import yazl from "yazl";

const JPEG = /\.jpe?g$/i;
// Cloudflare Pages refuses files over 25 MiB; keep some headroom.
const ORIGINAL_MAX_BYTES = 24.5 * 1024 * 1024;
// Bigger than this in the source zip isn't a photo export; don't load it into memory.
const ENTRY_MAX_BYTES = 200 * 1024 * 1024;
// Grid thumbnails: rows are at most 260px tall, so 520px covers 2x screens.
const THUMB_HEIGHT = 520;
const THUMB_MAX_WIDTH = 1600;
// What the lightbox shows. Originals already this small are shown as they are.
const LARGE_EDGE = 2560;
const LARGE_MAX_BYTES_AS_IS = 3 * 1024 * 1024;
// wrangler uploads at most 300 MiB per R2 object, so big shoots get several zips.
export const ZIP_PART_MAX_BYTES = 290 * 1024 * 1024;

// Junk that zips made on a Mac or Windows carry along.
function isJunk(name) {
  const base = path.posix.basename(name);
  return name.split("/").includes("__MACOSX") || base.startsWith(".") || base === "Thumbs.db";
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

// Returns { photos: [{ name, size, read() }], skipped: [name], close() },
// photos in file-name order (the order Lightroom exported them in).
export async function openInput(src) {
  const stat = await fs.stat(src).catch(() => null);
  if (!stat) throw new Error(`Can't find ${src}`);
  if (stat.isDirectory()) return openFolder(src);
  if (/\.zip$/i.test(src)) return openZip(src);
  throw new Error(`${src} isn't a .zip file or a folder`);
}

async function openFolder(dir) {
  const files = [];
  const skipped = [];
  for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const name = path.relative(dir, full).split(path.sep).join("/");
    if (isJunk(name)) continue;
    if (!JPEG.test(name)) {
      skipped.push(name);
      continue;
    }
    const { size } = await fs.stat(full);
    files.push({ name, size, read: () => fs.readFile(full) });
  }
  return { photos: files.sort(byName), skipped, close() {} };
}

async function openZip(file) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, z) => (err ? reject(err) : resolve(z))),
  ).catch((err) => {
    throw new Error(`Couldn't open ${file} as a zip: ${err.message}`);
  });
  const entries = await new Promise((resolve, reject) => {
    const list = [];
    zip.on("entry", (e) => {
      list.push(e);
      zip.readEntry();
    });
    zip.on("end", () => resolve(list));
    zip.on("error", reject);
    zip.readEntry();
  });
  const photos = [];
  const skipped = [];
  for (const entry of entries) {
    const name = entry.fileName;
    if (name.endsWith("/") || isJunk(name)) continue;
    if (!JPEG.test(name) || entry.uncompressedSize > ENTRY_MAX_BYTES) {
      skipped.push(name);
      continue;
    }
    photos.push({
      name,
      size: entry.uncompressedSize,
      read: () =>
        new Promise((resolve, reject) => {
          zip.openReadStream(entry, (err, stream) => {
            if (err) return reject(err);
            const chunks = [];
            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
          });
        }),
    });
  }
  return { photos: photos.sort(byName), skipped, close: () => zip.close() };
}

// Writes thumbs/<file>, photos/<file> (the download) and, when the original
// is big, large/<file> (what the lightbox shows). Throws if it isn't a JPEG.
export async function processPhoto(buf, galleryDir, file) {
  const meta = await sharp(buf).metadata();
  if (meta.format !== "jpeg") throw new Error(`not a JPEG (${meta.format})`);
  const sideways = (meta.orientation ?? 1) >= 5;
  const width = sideways ? meta.height : meta.width;
  const height = sideways ? meta.width : meta.height;

  // .rotate() turns the pixels upright, since the web sizes drop the EXIF orientation tag.
  const thumb = await sharp(buf)
    .rotate()
    .resize({ width: THUMB_MAX_WIDTH, height: THUMB_HEIGHT, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(path.join(galleryDir, "thumbs", file));

  let original = buf;
  let resaved = false;
  if (buf.length > ORIGINAL_MAX_BYTES) {
    original = await fitUnderLimit(buf);
    resaved = true;
  }
  await fs.writeFile(path.join(galleryDir, "photos", file), original);

  const large = Math.max(width, height) > LARGE_EDGE || original.length > LARGE_MAX_BYTES_AS_IS;
  let lw = width;
  let lh = height;
  if (large) {
    const info = await sharp(buf)
      .rotate()
      .resize({ width: LARGE_EDGE, height: LARGE_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(galleryDir, "large", file));
    lw = info.width;
    lh = info.height;
  }
  return { file, width, height, bytes: original.length, tw: thumb.width, th: thumb.height, large, lw, lh, resaved };
}

// Re-saves an original that's too big for Cloudflare Pages, keeping its
// metadata (and so its orientation tag, since the pixels aren't rotated).
async function fitUnderLimit(buf) {
  for (const quality of [94, 90, 86, 82]) {
    const out = await sharp(buf).keepMetadata().jpeg({ quality }).toBuffer();
    if (out.length <= ORIGINAL_MAX_BYTES) return out;
  }
  throw new Error("still over Cloudflare's 25 MB limit after re-saving it at quality 82");
}

// Packs the downloads into one zip, or into parts under ZIP_PART_MAX_BYTES.
// The split only depends on the files, so re-running it gives the same names.
export async function buildZips(photosDir, files, outDir, baseName, folderName, maxBytes = ZIP_PART_MAX_BYTES) {
  const groups = [];
  let group = [];
  let size = 0;
  for (const file of files) {
    const { size: bytes } = await fs.stat(path.join(photosDir, file));
    const cost = bytes + 2 * (file.length + folderName.length + 100); // headers
    if (group.length > 0 && size + cost > maxBytes) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(file);
    size += cost;
  }
  if (group.length > 0) groups.push(group);

  await fs.mkdir(outDir, { recursive: true });
  const zips = [];
  for (const [i, group] of groups.entries()) {
    const name = groups.length === 1 ? `${baseName}.zip` : `${baseName}-part-${i + 1}-of-${groups.length}.zip`;
    const zip = new yazl.ZipFile();
    for (const file of group) {
      // JPEGs don't compress, so store them as they are.
      zip.addFile(path.join(photosDir, file), `${folderName}/${file}`, { compress: false });
    }
    zip.end();
    const out = path.join(outDir, name);
    await pipeline(zip.outputStream, createWriteStream(out));
    const { size: bytes } = await fs.stat(out);
    zips.push({ name, bytes, count: group.length, uploaded: false });
  }
  return zips;
}
