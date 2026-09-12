import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./lib/files.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const probe = await readJson(join(root, "src", "data", "probe.json"));

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

function localTarget(href) {
  const path = href.split("#")[0].split("?")[0];
  if (!path || !path.startsWith("/")) return null;
  if (path === "/") return join(dist, "index.html");
  if (/\.[a-z0-9]+$/i.test(path)) return join(dist, path);
  return join(dist, path, "index.html");
}

const files = await filesUnder(dist);
const htmlFiles = files.filter((path) => path.endsWith(".html"));
const toolFiles = htmlFiles.filter((path) => relative(dist, path).startsWith("tools/"));
if (toolFiles.length !== probe.probe.toolPageCount) throw new Error(`Expected ${probe.probe.toolPageCount} tool pages, found ${toolFiles.length}`);

const titles = new Set();
const canonicals = new Set();
const contentHashes = new Set();
const missingLinks = [];
for (const path of htmlFiles) {
  const outputPath = relative(dist, path);
  const isIndexablePage = outputPath !== "404.html";
  const html = await readFile(path, "utf8");
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
  if (!title || !canonical) throw new Error(`Missing title or canonical: ${outputPath}`);
  if (titles.has(title)) throw new Error(`Duplicate title: ${title}`);
  if (canonicals.has(canonical)) throw new Error(`Duplicate canonical: ${canonical}`);
  titles.add(title);
  canonicals.add(canonical);

  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (isIndexablePage && text.length < 350) throw new Error(`Thin or empty page: ${outputPath}`);
  if (/test data|lorem ipsum/i.test(text)) throw new Error(`Synthetic or placeholder text: ${outputPath}`);
  const contentHash = createHash("sha256").update(text).digest("hex");
  if (contentHashes.has(contentHash)) throw new Error(`Trivially duplicated page content: ${outputPath}`);
  contentHashes.add(contentHash);

  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const target = localTarget(match[1]);
    if (target && !files.includes(target)) missingLinks.push(`${outputPath} -> ${match[1]}`);
  }
}
if (missingLinks.length) throw new Error(`Broken internal links:\n${missingLinks.join("\n")}`);

const sitemap = await readFile(join(dist, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (sitemapUrls.length !== probe.probe.indexablePageCount) throw new Error(`Expected ${probe.probe.indexablePageCount} sitemap URLs, found ${sitemapUrls.length}`);
if (new Set(sitemapUrls).size !== sitemapUrls.length) throw new Error("Duplicate sitemap URLs");

const robots = await readFile(join(dist, "robots.txt"), "utf8");
if (!robots.includes("Allow: /") || !robots.includes("Sitemap:")) throw new Error("robots.txt is incomplete");

process.stdout.write(`QA passed: ${toolFiles.length} tool pages, ${htmlFiles.length} HTML files, ${sitemapUrls.length} sitemap URLs, 0 broken links\n`);
