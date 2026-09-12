import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./lib/files.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = await readJson(join(root, "probe.config.json"));
const catalog = await readJson(join(root, "config", "tool-catalog.json"));
const dataset = await readJson(join(root, "data", "normalized-images.json"));

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

unique(catalog.map((tool) => tool.slug), "tool slug");
unique(catalog.map((tool) => tool.canonicalName.toLowerCase()), "canonical tool name");
unique(dataset.images.map((image) => image.id), "image id");

if (dataset.source.license !== "MIT") throw new Error("Dataset license provenance is not MIT");
if (!/^[0-9a-f]{40}$/.test(dataset.source.commit)) throw new Error("Source commit is not a full SHA");
if (dataset.images.length < 3) throw new Error("Dataset has too few images");
if (!dataset.images.some((image) => /^ubuntu/i.test(image.name))) throw new Error("Ubuntu coverage missing");
if (!dataset.images.some((image) => /^windows/i.test(image.name))) throw new Error("Windows coverage missing");
if (!dataset.images.some((image) => /^macos/i.test(image.name))) throw new Error("macOS coverage missing");

for (const image of dataset.images) {
  if (!image.imageVersion || !image.osVersion || !image.sourceSha256) throw new Error(`Incomplete image metadata: ${image.id}`);
  if (!image.sourceUrl.startsWith(`https://github.com/${config.source.repository}/blob/${dataset.source.commit}/`)) throw new Error(`Unpinned or non-official source: ${image.sourceUrl}`);
  unique(image.tools.map((tool) => tool.slug), `tool in ${image.id}`);
  for (const tool of image.tools) {
    if (!tool.available || tool.versions.length === 0 || tool.sourceNames.length === 0) throw new Error(`Empty tool evidence: ${tool.slug} / ${image.id}`);
  }
}

if (/test data|fixture/i.test(JSON.stringify(dataset))) throw new Error("Synthetic data marker found in real Probe dataset");
process.stdout.write(`Validated ${dataset.images.length} official images at ${dataset.source.commit.slice(0, 12)}\n`);
