// Where galleries live on this computer. Deliberately outside the site repo:
// the repo is public, so client photos must never end up in it.
//
//   ~/client-galleries/
//     config.json            Cloudflare project/bucket names and page text
//     shoots/<slug>.json     one manifest per gallery (title, photos, zips)
//     site/                  what gets deployed to Cloudflare Pages
//     zips/<slug>/           download-all zips, deleted once they're on R2

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const home = path.resolve(
  process.env.GALLERY_HOME || path.join(os.homedir(), "client-galleries"),
);
export const siteDir = path.join(home, "site");
export const shootsDir = path.join(home, "shoots");
export const zipsDir = path.join(home, "zips");
const configFile = path.join(home, "config.json");

export const defaults = {
  pagesProject: "danielfoster-galleries",
  siteUrl: "",
  r2Bucket: "danielfoster-galleries",
  r2PublicUrl: "",
  siteName: "Daniel Foster Photography",
  mainSiteUrl: "https://danielfosterphotography.nl",
  credit:
    "All photos © Daniel Foster. When you share them, please credit @danielfoster.photography",
};

export async function loadConfig() {
  try {
    return { ...defaults, ...JSON.parse(await fs.readFile(configFile, "utf8")) };
  } catch (err) {
    if (err.code === "ENOENT") return { ...defaults };
    throw new Error(`Couldn't read ${configFile}: ${err.message}`);
  }
}

export async function saveConfig(config) {
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n");
}

export async function loadShoots() {
  let names;
  try {
    names = await fs.readdir(shootsDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const shoots = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const file = path.join(shootsDir, name);
    try {
      shoots.push(JSON.parse(await fs.readFile(file, "utf8")));
    } catch (err) {
      throw new Error(`Couldn't read ${file}: ${err.message}`);
    }
  }
  return shoots.sort((a, b) => b.created.localeCompare(a.created));
}

export async function saveShoot(shoot) {
  await fs.mkdir(shootsDir, { recursive: true });
  await fs.writeFile(
    path.join(shootsDir, `${shoot.slug}.json`),
    JSON.stringify(shoot, null, 2) + "\n",
  );
}

export async function deleteShoot(slug) {
  await fs.rm(path.join(shootsDir, `${slug}.json`), { force: true });
  await fs.rm(path.join(siteDir, slug), { recursive: true, force: true });
  await fs.rm(path.join(zipsDir, slug), { recursive: true, force: true });
}

export function galleryUrl(config, slug) {
  const base = (config.siteUrl || `https://${config.pagesProject}.pages.dev`).replace(/\/+$/, "");
  return `${base}/${slug}/`;
}
