#!/usr/bin/env node
// Client galleries: turns a zip (or folder) of edited JPGs into an unlisted
// gallery page on Cloudflare Pages, with download-all zips on Cloudflare R2.
// See README.md for setup and the per-shoot steps.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { buildZips, openInput, processPhoto } from "./lib/photos.mjs";
import { countFiles, formatBytes, serve, writeGallery, writeShared } from "./lib/site.mjs";
import * as ws from "./lib/workspace.mjs";

const HELP = `Client galleries

  node gallery.mjs setup                         one time: log in to Cloudflare, create the site and storage
  node gallery.mjs new <zip-or-folder> --title "Phantom Four" [--date "11 October 2026"]
                                                 make a gallery from your exported JPGs
  node gallery.mjs preview                       look at the galleries on this computer first
  node gallery.mjs deploy                        put everything online and print the links
  node gallery.mjs list                          show your galleries and their links
  node gallery.mjs remove <name>                 take a gallery offline and delete it

Options for new:
  --title "..."     shown on the page and used for the file names (required)
  --date "..."      shown under the title, written however you like
  --keep-names      keep your original file names instead of title-001.jpg, title-002.jpg, ...

Galleries are kept in ${ws.home}
(set GALLERY_HOME to use another folder).`;

// Cloudflare Pages allows 20,000 files per site on the free plan.
const PAGES_MAX_FILES = 20000;

const require = createRequire(import.meta.url);

// Runs wrangler (Cloudflare's command-line tool, installed by npm install).
// With capture, returns its output instead of showing it.
function wrangler(args, { capture = false } = {}) {
  const bin = require.resolve("wrangler/bin/wrangler.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function mustWrangler(args, what) {
  const { code } = await wrangler(args);
  if (code !== 0) throw new Error(`${what} failed (see Cloudflare's message above).`);
}

function slugify(text) {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "gallery"
  );
}

// Lowercase letters and digits, without look-alikes (0/o, 1/l).
function randomSuffix(length = 6) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...randomBytes(length)].map((b) => alphabet[b % alphabet.length]).join("");
}

function progress(done, total) {
  if (process.stdout.isTTY) process.stdout.write(`\r  ${done} of ${total} photos done`);
  else if (done === total || done % 25 === 0) console.log(`  ${done} of ${total} photos done`);
}

async function cmdSetup(options) {
  const config = await ws.loadConfig();
  if (options.project) config.pagesProject = options.project;
  if (options.bucket) config.r2Bucket = options.bucket;

  console.log("Checking your Cloudflare login...");
  const who = await wrangler(["whoami"], { capture: true });
  if (who.code !== 0 || /not authenticated/i.test(who.out)) {
    console.log("A browser window will open: log in to Cloudflare (or sign up, it's free) and allow access.");
    await mustWrangler(["login"], "Logging in to Cloudflare");
  }

  console.log(`\nCreating the site "${config.pagesProject}" on Cloudflare Pages...`);
  const pages = await wrangler(["pages", "project", "create", config.pagesProject, "--production-branch", "main"], {
    capture: true,
  });
  let pagesUrl = pages.out.match(/https:\/\/[a-z0-9-]+\.pages\.dev/)?.[0];
  if (pages.code !== 0 && !/already exists/i.test(pages.out)) {
    console.log(pages.out);
    throw new Error("Couldn't create the Cloudflare Pages site. Try another name with --project my-name.");
  }
  if (!pagesUrl) {
    const list = await wrangler(["pages", "project", "list"], { capture: true });
    const row = list.out.split("\n").find((line) => line.includes(config.pagesProject));
    pagesUrl = row?.match(/[a-z0-9-]+\.pages\.dev/)?.[0];
    if (pagesUrl) pagesUrl = `https://${pagesUrl}`;
  }
  if (!config.siteUrl) config.siteUrl = pagesUrl ?? `https://${config.pagesProject}.pages.dev`;
  console.log(`  Galleries will be at ${config.siteUrl}/...`);

  if (options["skip-r2"]) {
    console.log('\nSkipping R2: galleries will have per-photo downloads but no "Download all" button.');
  } else {
    console.log(`\nCreating the storage bucket "${config.r2Bucket}" on Cloudflare R2 (for the download-all zips)...`);
    const bucket = await wrangler(["r2", "bucket", "create", config.r2Bucket], { capture: true });
    if (bucket.code !== 0 && !/already exists|already own/i.test(bucket.out)) {
      if (/10042|enable R2/i.test(bucket.out)) {
        console.log(
          "  R2 isn't switched on for your account yet. In the Cloudflare dashboard open R2 Object Storage" +
            " and follow the steps (it asks for a card but the free tier costs nothing), then run setup again." +
            '\n  Until then, galleries work without the "Download all" button.',
        );
      } else {
        console.log(bucket.out);
        console.log('  Couldn\'t create the bucket; galleries will work without the "Download all" button for now.');
      }
    } else {
      const dev = await wrangler(["r2", "bucket", "dev-url", "enable", config.r2Bucket, "-y"], { capture: true });
      const url = dev.out.match(/https:\/\/pub-[a-z0-9]+\.r2\.dev/)?.[0];
      if (url) {
        config.r2PublicUrl = url;
        console.log(`  Zips will download from ${url}/...`);
      } else {
        console.log(dev.out);
        console.log(
          `  Couldn't switch on the bucket's public address. Turn on "Public Development URL" for the bucket in` +
            ` the dashboard, then put that address in ${path.join(ws.home, "config.json")} as "r2PublicUrl".`,
        );
      }
    }
  }

  await ws.saveConfig(config);
  await fs.mkdir(ws.siteDir, { recursive: true });
  await writeShared(ws.siteDir, config);
  console.log(`\nSetup done. Settings are in ${path.join(ws.home, "config.json")}.`);
  console.log('Next: node gallery.mjs new path/to/photos.zip --title "Name of the shoot"');
}

async function cmdNew(src, options) {
  if (!src) throw new Error('Say which zip or folder to use: node gallery.mjs new photos.zip --title "Phantom Four"');
  const title = options.title?.trim();
  if (!title) throw new Error('Add a title: --title "Phantom Four"');
  const config = await ws.loadConfig();
  const prefix = slugify(title);
  const slug = `${prefix}-${randomSuffix()}`;
  const galleryDir = path.join(ws.siteDir, slug);

  const input = await openInput(path.resolve(src));
  try {
    if (input.photos.length === 0) throw new Error(`No .jpg files in ${src}.`);
    await fs.mkdir(ws.siteDir, { recursive: true });
    await writeShared(ws.siteDir, config);
    for (const dir of ["thumbs", "large", "photos"]) await fs.mkdir(path.join(galleryDir, dir), { recursive: true });

    console.log(`Making "${title}" from ${input.photos.length} photos...`);
    const results = new Array(input.photos.length);
    const failed = [];
    let next = 0;
    let done = 0;
    const workers = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (next < input.photos.length) {
          const i = next++;
          try {
            // Temporary name: the final numbering waits until we know which photos could be read.
            results[i] = await processPhoto(await input.photos[i].read(), galleryDir, `_tmp_${i}.jpg`);
          } catch (err) {
            failed.push(`${input.photos[i].name}: ${err.message}`);
          }
          progress(++done, input.photos.length);
        }
      }),
    );
    if (process.stdout.isTTY) process.stdout.write("\n");

    const kept = results.flatMap((photo, i) => (photo ? [{ photo, source: input.photos[i].name }] : []));
    if (kept.length === 0) {
      await fs.rm(galleryDir, { recursive: true, force: true });
      throw new Error(`None of the photos could be read:\n  ${failed.join("\n  ")}`);
    }
    // Final names: title-001.jpg, ... with no gaps, or the original names made URL-safe.
    // Neither can clash with a _tmp_ name, since slugify never makes underscores.
    const width = Math.max(3, String(kept.length).length);
    const used = new Set();
    for (const [n, { photo, source }] of kept.entries()) {
      let name = `${prefix}-${String(n + 1).padStart(width, "0")}.jpg`;
      if (options["keep-names"]) {
        const stem = slugify(path.posix.basename(source).replace(/\.jpe?g$/i, ""));
        name = `${stem}.jpg`;
        for (let k = 2; used.has(name); k++) name = `${stem}-${k}.jpg`;
        used.add(name);
      }
      for (const dir of photo.large ? ["thumbs", "large", "photos"] : ["thumbs", "photos"]) {
        await fs.rename(path.join(galleryDir, dir, photo.file), path.join(galleryDir, dir, name));
      }
      photo.file = name;
    }
    // Leftovers from photos that failed halfway.
    for (const dir of ["thumbs", "large", "photos"]) {
      for (const file of await fs.readdir(path.join(galleryDir, dir))) {
        if (file.startsWith("_tmp_")) await fs.rm(path.join(galleryDir, dir, file));
      }
    }
    const photos = kept.map((k) => k.photo);
    const shoot = {
      slug,
      title,
      date: options.date?.trim() || "",
      created: new Date().toISOString(),
      prefix,
      photos,
      zips: [],
    };
    await ws.saveShoot(shoot);
    await writeGallery(ws.siteDir, shoot, config);

    const total = photos.reduce((sum, p) => sum + p.bytes, 0);
    console.log(`\nMade "${title}": ${photos.length} photos, ${formatBytes(total)}.`);
    if (input.skipped.length > 0) console.log(`Skipped (not JPGs): ${input.skipped.join(", ")}`);
    if (failed.length > 0) console.log(`Couldn't read, left out:\n  ${failed.join("\n  ")}`);
    const resaved = photos.filter((p) => p.resaved).map((p) => p.file);
    if (resaved.length > 0) {
      console.log(`Re-saved at slightly lower quality to fit Cloudflare's 25 MB file limit: ${resaved.join(", ")}`);
    }
    console.log(`\nOnce deployed, the link will be:\n  ${ws.galleryUrl(config, slug)}`);
    console.log("\nNext: node gallery.mjs preview   (to look at it first)");
    console.log("      node gallery.mjs deploy    (to put it online)");
  } finally {
    input.close();
  }
}

async function cmdPreview(options) {
  const config = await ws.loadConfig();
  const shoots = await ws.loadShoots();
  if (shoots.length === 0) throw new Error("No galleries yet. Make one with: node gallery.mjs new photos.zip --title ...");
  await writeShared(ws.siteDir, config);
  for (const shoot of shoots) await writeGallery(ws.siteDir, shoot, config);
  const port = Number(options.port ?? 8788);
  await serve(ws.siteDir, port);
  console.log("Open these in your browser (Ctrl+C to stop):");
  for (const shoot of shoots) console.log(`  ${shoot.title}: http://localhost:${port}/${shoot.slug}/`);
  console.log('(The "Download all" button appears once the zips are uploaded by deploy.)');
}

async function uploadZips(shoot, config) {
  if (shoot.zips.length > 0 && shoot.zips.every((z) => z.uploaded)) return false;
  const outDir = path.join(ws.zipsDir, shoot.slug);
  const photosDir = path.join(ws.siteDir, shoot.slug, "photos");
  console.log(`\nPacking the download-all zip for "${shoot.title}"...`);
  const built = await buildZips(photosDir, shoot.photos.map((p) => p.file), outDir, `${shoot.prefix}-photos`, shoot.prefix);
  // Keep the upload state of parts that are already on R2 from an earlier run.
  const before = new Map(shoot.zips.map((z) => [z.name, z]));
  shoot.zips = built.map((z) => ({ ...z, uploaded: before.get(z.name)?.uploaded === true && before.get(z.name).bytes === z.bytes }));
  for (const zip of shoot.zips) {
    if (zip.uploaded) continue;
    console.log(`Uploading ${zip.name} (${formatBytes(zip.bytes)})...`);
    await mustWrangler(
      [
        "r2", "object", "put", `${config.r2Bucket}/${shoot.slug}/${zip.name}`,
        "--file", path.join(outDir, zip.name),
        "--remote",
        "--content-type", "application/zip",
        "--content-disposition", `attachment; filename="${zip.name}"`,
      ],
      `Uploading ${zip.name}`,
    );
    zip.uploaded = true;
    await ws.saveShoot(shoot);
  }
  await fs.rm(outDir, { recursive: true, force: true });
  return true;
}

async function cmdDeploy() {
  const config = await ws.loadConfig();
  if (!config.siteUrl) throw new Error("Run setup first: node gallery.mjs setup");
  const shoots = await ws.loadShoots();
  if (config.r2PublicUrl) {
    for (const shoot of shoots) {
      if (await uploadZips(shoot, config)) await ws.saveShoot(shoot);
    }
  } else if (shoots.length > 0) {
    console.log('No R2 bucket set up, so galleries go online without a "Download all" button.');
  }

  await fs.mkdir(ws.siteDir, { recursive: true });
  await writeShared(ws.siteDir, config);
  for (const shoot of shoots) await writeGallery(ws.siteDir, shoot, config);
  const files = await countFiles(ws.siteDir);
  if (files > PAGES_MAX_FILES) {
    throw new Error(
      `That's ${files} files, over Cloudflare Pages' limit of ${PAGES_MAX_FILES}. Remove an old gallery first (node gallery.mjs list).`,
    );
  }

  console.log("\nUploading the galleries to Cloudflare Pages (only new files are sent)...");
  await mustWrangler(
    [
      "pages", "deploy", ws.siteDir,
      "--project-name", config.pagesProject,
      "--branch", "main",
      "--commit-dirty=true",
      "--commit-message", `${shoots.length} galleries`,
    ],
    "Deploying to Cloudflare Pages",
  );
  console.log("\nOnline. Send these links (it can take a minute before a new one works):");
  for (const shoot of shoots) console.log(`  ${shoot.title}: ${ws.galleryUrl(config, shoot.slug)}`);
  if (shoots.length === 0) console.log("  (no galleries yet)");
}

async function cmdList() {
  const config = await ws.loadConfig();
  const shoots = await ws.loadShoots();
  if (shoots.length === 0) return console.log("No galleries yet.");
  for (const shoot of shoots) {
    const zips = shoot.zips.length > 0 && shoot.zips.every((z) => z.uploaded) ? "download-all zip online" : "no download-all zip yet";
    console.log(`${shoot.slug}\n  ${shoot.title}${shoot.date ? `, ${shoot.date}` : ""}: ${shoot.photos.length} photos, ${zips}`);
    console.log(`  ${ws.galleryUrl(config, shoot.slug)}`);
  }
}

async function cmdRemove(slug, options) {
  if (!slug) throw new Error("Say which gallery: node gallery.mjs remove <name> (names are in node gallery.mjs list)");
  const config = await ws.loadConfig();
  const shoot = (await ws.loadShoots()).find((s) => s.slug === slug);
  if (!shoot) throw new Error(`No gallery called ${slug}. See node gallery.mjs list.`);
  if (!options.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Take "${shoot.title}" (${shoot.photos.length} photos) offline and delete this computer's copy? Type yes: `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") return console.log("Nothing removed.");
  }
  for (const zip of shoot.zips.filter((z) => z.uploaded)) {
    console.log(`Deleting ${zip.name} from R2...`);
    await mustWrangler(["r2", "object", "delete", `${config.r2Bucket}/${slug}/${zip.name}`, "--remote"], `Deleting ${zip.name}`);
  }
  await ws.deleteShoot(slug);
  console.log(`Deleted "${shoot.title}" from this computer. Redeploying so the page goes offline...`);
  await cmdDeploy();
}

async function main() {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: "string" },
      date: { type: "string" },
      "keep-names": { type: "boolean" },
      port: { type: "string" },
      project: { type: "string" },
      bucket: { type: "string" },
      "skip-r2": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, arg] = positionals;
  if (options.help || !command || command === "help") return console.log(HELP);
  switch (command) {
    case "setup":
      return cmdSetup(options);
    case "new":
      return cmdNew(arg, options);
    case "preview":
      return cmdPreview(options);
    case "deploy":
      return cmdDeploy();
    case "list":
      return cmdList();
    case "remove":
      return cmdRemove(arg, options);
    default:
      throw new Error(`Unknown command "${command}". Run node gallery.mjs help.`);
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
});
