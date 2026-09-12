import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "./lib/files.mjs";
import { extractToolEvidence, parseManifestMetadata } from "./lib/source-parser.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalog = await readJson(join(root, "config", "tool-catalog.json"));
const snapshot = await readJson(join(root, "data", "source-snapshot.json"));

const images = [];
for (const sourceImage of snapshot.images) {
  const markdown = await readFile(join(root, ".cache", "source", sourceImage.cacheFile), "utf8");
  const metadata = parseManifestMetadata(markdown);
  const tools = catalog.map((definition) => ({
    slug: definition.slug,
    ...extractToolEvidence(markdown, definition),
  })).filter((tool) => tool.available);

  images.push({
    id: sourceImage.id,
    name: sourceImage.name,
    architecture: sourceImage.architecture,
    labels: sourceImage.labels,
    lifecycle: sourceImage.lifecycle,
    osVersion: metadata.osVersion,
    imageVersion: metadata.imageVersion,
    sourcePath: sourceImage.sourcePath,
    sourceUrl: sourceImage.sourceUrl,
    sourceSha256: sourceImage.sha256,
    tools,
  });
}

await writeJson(join(root, "data", "normalized-images.json"), {
  schemaVersion: 1,
  source: {
    repository: snapshot.repository,
    commit: snapshot.commit,
    committedAt: snapshot.committedAt,
    fetchedAt: snapshot.fetchedAt,
    repositoryUrl: snapshot.repositoryUrl,
    license: snapshot.license,
    licenseUrl: snapshot.licenseUrl,
  },
  images,
});

process.stdout.write(`Normalized ${images.length} images and ${images.reduce((sum, image) => sum + image.tools.length, 0)} tool-image facts\n`);
