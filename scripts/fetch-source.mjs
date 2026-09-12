import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, readJsonIfPresent, writeJson } from "./lib/files.mjs";
import { parseRepositoryImageIndex } from "./lib/source-parser.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = await readJson(join(root, "probe.config.json"));
const cacheDirectory = join(root, ".cache", "source");
const snapshotPath = join(root, "data", "source-snapshot.json");
const localSourceDirectory = process.env.RUNNER_IMAGES_SOURCE_DIR;
const requestedRef = process.env.RUNNER_IMAGES_REF ?? config.source.defaultRef;

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "serp-engine-probe/1.0" } });
  if (!response.ok) throw new Error(`Source fetch failed (${response.status}): ${url}`);
  return response.text();
}

async function remoteRevision() {
  const response = await fetch(`https://api.github.com/repos/${config.source.repository}/commits/${encodeURIComponent(requestedRef)}`, {
    headers: { "Accept": "application/vnd.github+json", "User-Agent": "serp-engine-probe/1.0" },
  });
  if (!response.ok) throw new Error(`Unable to resolve runner-images revision (${response.status})`);
  const payload = await response.json();
  return { commit: payload.sha, committedAt: payload.commit.committer.date };
}

async function sourceText(path, commit) {
  if (localSourceDirectory) return readFile(join(localSourceDirectory, path), "utf8");
  return fetchText(`https://raw.githubusercontent.com/${config.source.repository}/${commit}/${path}`);
}

const revision = localSourceDirectory
  ? {
      commit: execFileSync("git", ["-C", localSourceDirectory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      committedAt: execFileSync("git", ["-C", localSourceDirectory, "log", "-1", "--format=%cI"], { encoding: "utf8" }).trim(),
    }
  : await remoteRevision();

const previousSnapshot = await readJsonIfPresent(snapshotPath);
const fetchedAt = previousSnapshot?.commit === revision.commit ? previousSnapshot.fetchedAt : new Date().toISOString();
const readme = await sourceText("README.md", revision.commit);
const license = await sourceText("LICENSE", revision.commit);
if (!/MIT License/i.test(license) || !/Permission is hereby granted/i.test(license)) {
  throw new Error("Expected MIT license text was not found; ingestion stopped");
}

const indexedImages = parseRepositoryImageIndex(readme);
if (indexedImages.length < 3) throw new Error("Official image index did not expose Ubuntu, Windows, and macOS manifests");

await mkdir(cacheDirectory, { recursive: true });
const images = [];
for (const image of indexedImages) {
  const content = await sourceText(image.sourcePath, revision.commit);
  const cacheFile = `${image.sourcePath.replaceAll("/", "__")}`;
  await writeFile(join(cacheDirectory, cacheFile), content, "utf8");
  images.push({
    ...image,
    sourceUrl: `https://github.com/${config.source.repository}/blob/${revision.commit}/${image.sourcePath}`,
    cacheFile,
    sha256: checksum(content),
  });
}

const operatingSystems = new Set(images.map((image) => image.name.split(" ")[0].toLowerCase().replace("macos", "macos")));
if (![...operatingSystems].some((name) => name.startsWith("ubuntu")) || ![...operatingSystems].some((name) => name.startsWith("windows")) || ![...operatingSystems].some((name) => name.startsWith("macos"))) {
  throw new Error("At least one Ubuntu, Windows, and macOS image is required");
}

await writeJson(snapshotPath, {
  schemaVersion: 1,
  repository: config.source.repository,
  commit: revision.commit,
  committedAt: revision.committedAt,
  fetchedAt,
  repositoryUrl: `https://github.com/${config.source.repository}`,
  license: config.source.license,
  licenseUrl: `https://github.com/${config.source.repository}/blob/${revision.commit}/LICENSE`,
  licenseSha256: checksum(license),
  readmeSha256: checksum(readme),
  images,
});

process.stdout.write(`Fetched ${images.length} official manifests at ${revision.commit.slice(0, 12)} (${basename(snapshotPath)})\n`);
