#!/usr/bin/env node
// Client galleries: turns a zip (or folder) of edited JPGs into an unlisted
// gallery page on Cloudflare Pages, with download-all zips on Cloudflare R2.
// See README.md for setup and the per-shoot steps.

import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { ENTRY_MAX_MB, bestNumber, buildZips, openInput, processPhoto } from "./lib/photos.mjs";
import { countFiles, formatBytes, serve, writeGallery, writeShared } from "./lib/site.mjs";
import * as ws from "./lib/workspace.mjs";
import { findPagesUrl, mustWrangler, parseAccounts, useAccount, wrangler } from "./lib/wrangler.mjs";

const HELP = `Client galleries

  node gallery.mjs setup                         one time: log in to Cloudflare, create the site and storage
  node gallery.mjs domain galleries.example.com  use your own address for the links (see README)
  node gallery.mjs new <zip-or-folder> --title "Phantom Four" [--date "11 October 2026"]
                                                 make a gallery from your exported JPGs
  node gallery.mjs preview                       look at the galleries on this computer first
  node gallery.mjs deploy                        put everything online and print the links
  node gallery.mjs list                          show your galleries and their links
  node gallery.mjs remove <name>                 take a gallery offline and delete it

Options for new:
  --title "..."     shown on the page and used for the address and file names (required)
  --date "..."      shown under the title, written however you like
  --address name    use another address than the title, e.g. --address phantom-four-2026
  --private         add a random code to the address so it can't be guessed
  --keep-names      keep your original file names instead of title-001.jpg, title-002.jpg, ...

Galleries are kept in ${ws.home}
(set GALLERY_HOME to use another folder).`;

// Cloudflare Pages allows 20,000 files per site on the free plan.
const PAGES_MAX_FILES = 20000;

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

// The code --private adds to an address. The title part is easy to guess, so
// this carries it all: 10 characters from 32 is 50 bits, far beyond guessing.
// Lowercase letters and digits, without look-alikes (0/o, 1/l).
function randomSuffix(length = 10) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...randomBytes(length)].map((b) => alphabet[b % alphabet.length]).join("");
}

function progress(done, total) {
  if (process.stdout.isTTY) process.stdout.write(`\r  ${done} of ${total} photos done`);
  else if (done === total || done % 25 === 0) console.log(`  ${done} of ${total} photos done`);
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function cmdSetup(options) {
  const config = await ws.loadConfig();
  const projectChanged = Boolean(options.project) && options.project !== config.pagesProject;
  if (projectChanged) config.pagesUrl = "";
  if (options.project) config.pagesProject = options.project;
  if (options.bucket) config.r2Bucket = options.bucket;

  console.log("Checking your Cloudflare login...");
  let who = await wrangler(["whoami"], { capture: true });
  if (who.code !== 0 || /not authenticated/i.test(who.out)) {
    console.log("A browser window will open: log in to Cloudflare (or sign up, it's free) and allow access.");
    await mustWrangler(["login"], "Logging in to Cloudflare");
    who = await wrangler(["whoami"], { capture: true });
  }
  const accounts = parseAccounts(who.out);
  if (accounts.length === 0) {
    console.log(who.out);
    throw new Error("Couldn't find your Cloudflare account. Check the message above, then run setup again.");
  }
  if (!accounts.some((a) => a.id === config.accountId)) {
    config.accountId = accounts[0].id;
    if (accounts.length > 1) {
      console.log("Your login has several Cloudflare accounts:");
      accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
      const pick = Number(await ask(`Which one should hold the galleries? (1-${accounts.length}): `));
      if (!Number.isInteger(pick) || pick < 1 || pick > accounts.length) throw new Error("No account picked; nothing changed.");
      config.accountId = accounts[pick - 1].id;
    }
  }
  useAccount(config.accountId);

  console.log(`\nCreating the site "${config.pagesProject}" on Cloudflare Pages...`);
  const pages = await wrangler(["pages", "project", "create", config.pagesProject, "--production-branch", "main"], {
    capture: true,
  });
  if (pages.code !== 0 && !/already exists/i.test(pages.out)) {
    console.log(pages.out);
    throw new Error("Couldn't create the Cloudflare Pages site (see the message above).");
  }
  let pagesUrl = pages.out.match(/https:\/\/[a-z0-9-]+\.pages\.dev/)?.[0];
  if (!pagesUrl) pagesUrl = findPagesUrl((await wrangler(["pages", "project", "list"], { capture: true })).out, config.pagesProject);
  config.pagesUrl = pagesUrl ?? `https://${config.pagesProject}.pages.dev`;
  // Keep a custom domain the user set, unless the project itself changed.
  if (!config.siteUrl || projectChanged || /\.pages\.dev\/?$/.test(config.siteUrl)) config.siteUrl = config.pagesUrl;
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

// Processes every photo into dir, a few at a time. Returns results in input
// order (undefined where a photo failed) and the failures.
async function processAll(input, dir) {
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
          results[i] = await processPhoto(await input.photos[i].read(), dir, `_tmp_${i}.jpg`);
        } catch (err) {
          failed.push(`${input.photos[i].name}: ${err.message}`);
        }
        progress(++done, input.photos.length);
      }
    }),
  );
  if (process.stdout.isTTY) process.stdout.write("\n");
  return { results, failed };
}

// Final names: title-001.jpg, ... with no gaps, or the original names made URL-safe.
// Neither can clash with a _tmp_ name, since slugify never makes underscores.
async function nameFiles(kept, dir, prefix, keepNames) {
  const width = Math.max(3, String(kept.length).length);
  const used = new Set();
  for (const [n, { photo, source }] of kept.entries()) {
    let name = `${prefix}-${String(n + 1).padStart(width, "0")}.jpg`;
    if (keepNames) {
      const stem = slugify(path.posix.basename(source).replace(/\.jpe?g$/i, ""));
      name = `${stem}.jpg`;
      for (let k = 2; used.has(name); k++) name = `${stem}-${k}.jpg`;
      used.add(name);
    }
    for (const sub of photo.large ? ["thumbs", "large", "photos"] : ["thumbs", "photos"]) {
      await fs.rename(path.join(dir, sub, photo.file), path.join(dir, sub, name));
    }
    photo.file = name;
  }
  // Leftovers from photos that failed halfway.
  for (const sub of ["thumbs", "large", "photos"]) {
    for (const file of await fs.readdir(path.join(dir, sub))) {
      if (file.startsWith("_tmp_")) await fs.rm(path.join(dir, sub, file));
    }
  }
}

async function cmdNew(src, options) {
  if (!src) throw new Error('Say which zip or folder to use: node gallery.mjs new photos.zip --title "Phantom Four"');
  const title = options.title?.trim();
  if (!title) throw new Error('Add a title: --title "Phantom Four"');
  const config = await ws.loadConfig();
  const prefix = slugify(title);
  let slug = options.address ? slugify(options.address) : prefix;
  if (options.private) slug = `${slug}-${randomSuffix()}`;
  // site/assets holds the files every gallery shares.
  if (slug === "assets") throw new Error('"assets" is taken by the site itself. Pick another address with --address.');
  if (existsSync(path.join(ws.shootsDir, `${slug}.json`)) || existsSync(path.join(ws.siteDir, slug))) {
    throw new Error(
      `There's already a gallery at /${slug}. Give this one another address (--address ${slug}-2) or remove the old one first.`,
    );
  }
  // Built outside site/ and moved in when complete, so a deploy never
  // uploads a half-made gallery.
  const buildDir = path.join(ws.buildingDir, slug);
  const finalDir = path.join(ws.siteDir, slug);
  // Only removes finalDir once this run has moved the gallery there, so a
  // clash with a gallery that appeared meanwhile never deletes that one.
  let moved = false;
  const cleanUp = () => {
    rmSync(buildDir, { recursive: true, force: true });
    if (moved) rmSync(finalDir, { recursive: true, force: true });
  };
  const onInterrupt = () => {
    cleanUp();
    console.log("\nStopped; nothing was kept.");
    process.exit(130);
  };

  const input = await openInput(path.resolve(src));
  process.once("SIGINT", onInterrupt);
  let saved = false;
  try {
    if (input.photos.length === 0) throw new Error(`No .jpg files in ${src}.`);
    for (const sub of ["thumbs", "large", "photos"]) await fs.mkdir(path.join(buildDir, sub), { recursive: true });

    console.log(`Making "${title}" from ${input.photos.length} photos...`);
    const { results, failed } = await processAll(input, buildDir);
    const kept = results.flatMap((photo, i) => (photo ? [{ photo, source: input.photos[i].name }] : []));
    for (const { photo, source } of kept) photo.best = bestNumber(source) !== undefined;
    if (kept.length === 0) throw new Error(`None of the photos could be read:\n  ${failed.join("\n  ")}`);
    await nameFiles(kept, buildDir, prefix, options["keep-names"]);

    const shoot = {
      slug,
      title,
      date: options.date?.trim() || "",
      created: new Date().toISOString(),
      prefix,
      photos: kept.map((k) => k.photo),
      zips: [],
      deployed: false,
    };
    await fs.mkdir(ws.siteDir, { recursive: true });
    await writeShared(ws.siteDir, config);
    await fs.rename(buildDir, finalDir);
    moved = true;
    await writeGallery(ws.siteDir, shoot, config);
    await ws.saveShoot(shoot);
    saved = true;

    const total = shoot.photos.reduce((sum, p) => sum + p.bytes, 0);
    const best = shoot.photos.filter((p) => p.best).length;
    console.log(`\nMade "${title}": ${shoot.photos.length} photos, ${formatBytes(total)}.`);
    console.log(
      best > 0
        ? `${best} highlight${best === 1 ? "" : "s"} (best1.jpg, best2.jpg, ...) shown large at the top.`
        : "No photos named best1.jpg, best2.jpg, ... so the page opens with the grid.",
    );
    if (input.skipped.length > 0) console.log(`Skipped (not JPGs): ${input.skipped.join(", ")}`);
    if (input.tooBig.length > 0) console.log(`Skipped (over ${ENTRY_MAX_MB} MB, too big for a photo export): ${input.tooBig.join(", ")}`);
    if (failed.length > 0) console.log(`Couldn't read, left out:\n  ${failed.join("\n  ")}`);
    const resaved = shoot.photos.filter((p) => p.resaved).map((p) => p.file);
    if (resaved.length > 0) {
      console.log(`Re-saved at slightly lower quality to fit Cloudflare's 25 MB file limit: ${resaved.join(", ")}`);
    }
    console.log(`\nOnce deployed, the link will be:\n  ${ws.galleryUrl(config, slug)}`);
    console.log("\nNext: node gallery.mjs preview   (to look at it first)");
    console.log("      node gallery.mjs deploy    (to put it online)");
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    input.close();
    if (!saved) cleanUp();
  }
}

// Points the printed links at your own address. Cloudflare and your domain
// provider need setting up too; this prints how.
async function cmdDomain(domain) {
  const host = domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host || !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) {
    throw new Error("Say which address: node gallery.mjs domain galleries.danielfosterphotography.nl");
  }
  const config = await ws.loadConfig();
  const target = (config.pagesUrl || `https://${config.pagesProject}.pages.dev`).replace(/^https:\/\//, "").replace(/\/+$/, "");
  const name = host.split(".").slice(0, -2).join(".");
  if (!name) {
    // A bare domain only works on Cloudflare Pages if the domain's DNS moves to Cloudflare.
    throw new Error(`Use a subdomain, like galleries.${host}: your main site already lives on ${host}.`);
  }
  config.siteUrl = `https://${host}`;
  await ws.saveConfig(config);
  console.log(`Links will now use https://${host}/...

Two things to set up once, if you haven't yet:

1. Cloudflare: in the dashboard open Workers & Pages, then "${config.pagesProject}", then
   Custom domains. Click "Set up a custom domain", enter ${host} and continue.

2. Your domain provider (Porkbun: Domain Management, then DNS next to your domain): add a record
     Type:    CNAME
     Host:    ${name}
     Answer:  ${target}
   Leave the rest as it is. If Cloudflare shows a different value to use, use that.

Cloudflare checks the record and turns on HTTPS by itself. That takes a few minutes, sometimes
up to a day; the custom domain shows "Active" when it's ready. Until then, links on
${target} keep working.`);
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

const sizeIs = (file, bytes) =>
  fs.stat(file).then(
    (s) => s.size === bytes,
    () => false,
  );

// Packs and uploads the download-all zip(s) a gallery doesn't have on R2 yet.
// Returns true if anything changed.
async function uploadZips(shoot, config) {
  if (ws.zipsOnline(shoot)) return false;
  const outDir = path.join(ws.zipsDir, shoot.slug);
  // Parts still waiting from an interrupted run are reused; otherwise pack again.
  const waiting = shoot.zips.filter((z) => !z.uploaded);
  const reusable =
    shoot.zips.length > 0 && (await Promise.all(waiting.map((z) => sizeIs(path.join(outDir, z.name), z.bytes)))).every(Boolean);
  if (!reusable) {
    console.log(`\nPacking the download-all zip for "${shoot.title}"...`);
    const photosDir = path.join(ws.siteDir, shoot.slug, "photos");
    const built = await buildZips(photosDir, shoot.photos.map((p) => p.file), outDir, `${shoot.prefix}-photos`, shoot.prefix);
    // The split only depends on the photos, so parts already on R2 keep their names.
    const before = new Map(shoot.zips.map((z) => [z.name, z]));
    shoot.zips = built.map((z) => {
      const old = before.get(z.name);
      return { ...z, uploaded: old?.uploaded === true && old.bytes === z.bytes };
    });
  }
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
  useAccount(config.accountId);
  const shoots = await ws.loadShoots();

  // Check the file limit before spending minutes on zip uploads.
  await fs.mkdir(ws.siteDir, { recursive: true });
  await writeShared(ws.siteDir, config);
  for (const shoot of shoots) await writeGallery(ws.siteDir, shoot, config);
  const files = await countFiles(ws.siteDir);
  if (files > PAGES_MAX_FILES) {
    throw new Error(
      `That's ${files} files, over Cloudflare Pages' limit of ${PAGES_MAX_FILES}. Remove an old gallery first (node gallery.mjs list).`,
    );
  }

  if (config.r2PublicUrl) {
    for (const shoot of shoots) {
      if (await uploadZips(shoot, config)) {
        await ws.saveShoot(shoot);
        await writeGallery(ws.siteDir, shoot, config);
      }
    }
  } else if (shoots.length > 0) {
    console.log('No R2 bucket set up, so galleries go online without a "Download all" button.');
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
  for (const shoot of shoots.filter((s) => !s.deployed)) {
    shoot.deployed = true;
    await ws.saveShoot(shoot);
  }
  console.log("\nOnline. Send these links (it can take a minute before a new one works):");
  for (const shoot of shoots) console.log(`  ${shoot.title}: ${ws.galleryUrl(config, shoot.slug)}`);
  if (shoots.length === 0) console.log("  (no galleries yet)");
}

async function cmdList() {
  const config = await ws.loadConfig();
  const shoots = await ws.loadShoots();
  if (shoots.length === 0) return console.log("No galleries yet.");
  for (const shoot of shoots) {
    const state = !shoot.deployed
      ? "not online yet (run deploy)"
      : ws.zipsOnline(shoot)
        ? "online with download-all zip"
        : "online, no download-all zip";
    console.log(`${shoot.slug}\n  ${shoot.title}${shoot.date ? `, ${shoot.date}` : ""}: ${shoot.photos.length} photos, ${state}`);
    console.log(`  ${ws.galleryUrl(config, shoot.slug)}`);
  }
}

async function cmdRemove(slug, options) {
  if (!slug) throw new Error("Say which gallery: node gallery.mjs remove <name> (names are in node gallery.mjs list)");
  const config = await ws.loadConfig();
  useAccount(config.accountId);
  const shoots = await ws.loadShoots();
  const shoot = shoots.find((s) => s.slug === slug);
  if (!shoot) throw new Error(`No gallery called ${slug}. See node gallery.mjs list.`);
  if (!options.yes) {
    // Taking a page down means deploying the whole site again, which also
    // publishes galleries made since the last deploy.
    const pending = shoots.filter((s) => s.slug !== slug && !s.deployed).map((s) => `"${s.title}"`);
    const also = pending.length > 0 ? `\nThis also puts ${pending.join(", ")} online, since the site is redeployed.` : "";
    const answer = await ask(
      `Take "${shoot.title}" (${shoot.photos.length} photos) offline and delete this computer's copy?${also}\nType yes: `,
    );
    if (answer.toLowerCase() !== "yes") return console.log("Nothing removed.");
  }
  for (const zip of shoot.zips.filter((z) => z.uploaded)) {
    console.log(`Deleting ${zip.name} from R2...`);
    await mustWrangler(["r2", "object", "delete", `${config.r2Bucket}/${slug}/${zip.name}`, "--remote"], `Deleting ${zip.name}`);
    zip.uploaded = false;
    await ws.saveShoot(shoot);
  }
  await ws.deleteShoot(slug);
  console.log(`Deleted "${shoot.title}" from this computer. Redeploying so the page goes offline...`);
  try {
    await cmdDeploy();
  } catch (err) {
    throw new Error(
      `${err.message}\n"${shoot.title}" is deleted from this computer, but its page stays online until a deploy` +
        " works. Run: node gallery.mjs deploy",
    );
  }
}

async function main() {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: "string" },
      date: { type: "string" },
      "keep-names": { type: "boolean" },
      address: { type: "string" },
      private: { type: "boolean" },
      port: { type: "string" },
      project: { type: "string" },
      bucket: { type: "string" },
      "skip-r2": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, arg, ...extra] = positionals;
  if (options.help || !command || command === "help") return console.log(HELP);
  if (extra.length > 0) {
    // Usually an unquoted title: --title Phantom Four reads as title "Phantom" plus "Four".
    throw new Error(`Didn't expect "${extra.join(" ")}". Put titles and dates in quotes: --title "Phantom Four"`);
  }
  switch (command) {
    case "setup":
      return cmdSetup(options);
    case "domain":
      return cmdDomain(arg);
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
