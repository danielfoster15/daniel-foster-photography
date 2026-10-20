// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import yauzl from "yauzl";
import yazl from "yazl";
import { buildZips, openInput, processPhoto } from "../lib/photos.mjs";
import { galleryHtml } from "../lib/site.mjs";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-test-"));
test.after(() => fs.rm(tmp, { recursive: true, force: true }));

const jpeg = (width, height, options = {}) =>
  sharp({ create: { width, height, channels: 3, background: "#804020" } })
    .withMetadata(options)
    .jpeg()
    .toBuffer();

async function writeZip(file, entries) {
  const zip = new yazl.ZipFile();
  for (const [name, buf] of entries) zip.addBuffer(buf, name);
  zip.end();
  await fs.writeFile(file, Buffer.concat(await zip.outputStream.toArray()));
}

function zipNames(file) {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const names = [];
      zip.on("entry", (e) => {
        names.push(e.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve(names));
      zip.readEntry();
    }),
  );
}

test("reads JPEGs from a zip in file-name order, skipping Mac junk and other files", async () => {
  const file = path.join(tmp, "in.zip");
  const photo = await jpeg(40, 30);
  await writeZip(file, [
    ["shoot/IMG_10.jpg", photo],
    ["shoot/IMG_9.JPG", photo],
    ["shoot/__MACOSX/._IMG_9.JPG", Buffer.from("junk")],
    ["shoot/.DS_Store", Buffer.from("junk")],
    ["shoot/notes.txt", Buffer.from("hi")],
  ]);
  const input = await openInput(file);
  try {
    assert.deepEqual(
      input.photos.map((p) => p.name),
      ["shoot/IMG_9.JPG", "shoot/IMG_10.jpg"],
    );
    assert.deepEqual(input.skipped, ["shoot/notes.txt"]);
    assert.deepEqual(await input.photos[0].read(), photo);
  } finally {
    input.close();
  }
});

test("web sizes are turned upright; the download keeps the original bytes", async () => {
  const dir = path.join(tmp, "gallery");
  for (const sub of ["thumbs", "large", "photos"]) await fs.mkdir(path.join(dir, sub), { recursive: true });
  // Stored landscape with orientation 6: displays as portrait.
  const buf = await jpeg(3000, 2000, { orientation: 6 });
  const photo = await processPhoto(buf, dir, "a.jpg");
  assert.equal(photo.width, 2000);
  assert.equal(photo.height, 3000);
  assert.ok(photo.th > photo.tw, "thumbnail is portrait");
  assert.equal(photo.large, true);
  const large = await sharp(path.join(dir, "large", "a.jpg")).metadata();
  assert.deepEqual([large.width, large.height], [photo.lw, photo.lh]);
  assert.ok(large.height > large.width);
  assert.deepEqual(await fs.readFile(path.join(dir, "photos", "a.jpg")), buf);

  await assert.rejects(processPhoto(Buffer.from("not a photo"), dir, "b.jpg"));
});

test("download-all zips split into parts under the size limit", async () => {
  const photos = path.join(tmp, "photos");
  await fs.mkdir(photos, { recursive: true });
  const files = [];
  for (let i = 1; i <= 5; i++) {
    files.push(`p-${i}.jpg`);
    await fs.writeFile(path.join(photos, `p-${i}.jpg`), Buffer.alloc(1000, i));
  }
  const one = await buildZips(photos, files, path.join(tmp, "z1"), "show-photos", "show");
  assert.deepEqual(one.map((z) => [z.name, z.count]), [["show-photos.zip", 5]]);
  assert.deepEqual(await zipNames(path.join(tmp, "z1", "show-photos.zip")), files.map((f) => `show/${f}`));

  const parts = await buildZips(photos, files, path.join(tmp, "z2"), "show-photos", "show", 2500);
  assert.deepEqual(
    parts.map((z) => [z.name, z.count]),
    [
      ["show-photos-part-1-of-3.zip", 2],
      ["show-photos-part-2-of-3.zip", 2],
      ["show-photos-part-3-of-3.zip", 1],
    ],
  );
  for (const zip of parts) assert.ok(zip.bytes <= 2500);
});

test("gallery page escapes text and links each zip part", () => {
  const shoot = {
    slug: "show-abc234",
    title: "Rock & <Roll>",
    date: "11 Oct",
    photos: [
      { file: "show-001.jpg", tw: 780, th: 520, lw: 2560, lh: 1707, large: true },
      { file: "show-002.jpg", tw: 347, th: 520, lw: 1365, lh: 2048, large: false },
    ],
    zips: [
      { name: "show-photos-part-1-of-2.zip", bytes: 290 * 1024 ** 2, count: 1, uploaded: true },
      { name: "show-photos-part-2-of-2.zip", bytes: 10 * 1024 ** 2, count: 1, uploaded: true },
    ],
  };
  const config = { siteName: "DF", mainSiteUrl: "https://example.com", credit: "© me", r2PublicUrl: "https://pub-x.r2.dev/" };
  const html = galleryHtml(shoot, config);
  assert.match(html, /<h1>Rock &amp; &lt;Roll&gt;<\/h1>/);
  assert.match(html, /href="\/show-abc234\/large\/show-001.jpg"/);
  assert.match(html, /href="\/show-abc234\/photos\/show-002.jpg" data-pswp-width="1365"/);
  assert.match(html, /href="https:\/\/pub-x.r2.dev\/show-abc234\/show-photos-part-2-of-2.zip">Part 2 <small>\(photos 2–2, 10 MB\)/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);

  // No button until every part is on R2.
  shoot.zips[1].uploaded = false;
  assert.doesNotMatch(galleryHtml(shoot, config), /r2\.dev/);
});
