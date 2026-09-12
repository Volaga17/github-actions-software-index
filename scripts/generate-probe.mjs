import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectChanges } from "./lib/source-parser.mjs";
import { readJson, readJsonIfPresent, writeJson } from "./lib/files.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = await readJson(join(root, "probe.config.json"));
const seo = await readJson(join(root, "seo.config.json"));
const state = await readJson(join(root, "serp-engine-state.json"));
const catalog = await readJson(join(root, "config", "tool-catalog.json"));
const dataset = await readJson(join(root, "data", "normalized-images.json"));
const outputPath = join(root, "src", "data", "probe.json");
const previousProbe = await readJsonIfPresent(outputPath);

function operatingSystem(name) {
  if (/^ubuntu/i.test(name)) return "Ubuntu";
  if (/^windows/i.test(name)) return "Windows";
  return "macOS";
}

const allTools = catalog.map((definition) => {
  const availability = dataset.images.map((image) => {
    const evidence = image.tools.find((tool) => tool.slug === definition.slug);
    return {
      imageId: image.id,
      imageName: image.name,
      operatingSystem: operatingSystem(image.name),
      architecture: image.architecture,
      labels: image.labels,
      lifecycle: image.lifecycle,
      available: Boolean(evidence),
      versions: evidence?.versions ?? [],
      sourceNames: evidence?.sourceNames ?? [],
      imageVersion: image.imageVersion,
      osVersion: image.osVersion,
      sourceUrl: image.sourceUrl,
      sourceSha256: image.sourceSha256,
      fetchedAt: dataset.source.fetchedAt,
    };
  });
  const listedRows = availability.filter((row) => row.available);
  const versionSignatures = new Set(listedRows.map((row) => row.versions.join(",")));
  const osCoverage = new Set(listedRows.map((row) => row.operatingSystem)).size;
  const weights = config.selection.weights;
  const selectionScore = definition.queryEvidence * weights.queryEvidence
    + definition.ciUtility * weights.ciUtility
    + Math.min(listedRows.length, 10) * weights.imageOccurrence
    + osCoverage * weights.operatingSystemCoverage
    + Math.min(versionSignatures.size, 5) * weights.versionVariability;
  return {
    canonicalName: definition.canonicalName,
    slug: definition.slug,
    family: definition.family,
    aliases: definition.aliases,
    verifyCommand: definition.verifyCommand,
    queryEvidence: definition.queryEvidence,
    ciUtility: definition.ciUtility,
    selectionScore,
    listedImageCount: listedRows.length,
    totalImageCount: availability.length,
    operatingSystemCoverage: osCoverage,
    versionVariability: versionSignatures.size,
    availability,
  };
}).filter((tool) => tool.listedImageCount >= config.selection.minimumImageOccurrences);

const selected = allTools
  .sort((left, right) => right.selectionScore - left.selectionScore || left.canonicalName.localeCompare(right.canonicalName))
  .slice(0, config.targetToolPageCount)
  .map((tool) => ({ ...tool }));

for (const tool of selected) {
  tool.relatedTools = selected
    .filter((candidate) => candidate.family === tool.family && candidate.slug !== tool.slug)
    .slice(0, 4)
    .map(({ canonicalName, slug }) => ({ canonicalName, slug }));
}

if (selected.length < config.minimumToolPageCount || selected.length > config.maximumToolPageCount) {
  throw new Error(`Generated ${selected.length} tool pages outside configured Probe range`);
}

const changes = previousProbe?.source.commit === dataset.source.commit ? [] : detectChanges(previousProbe, selected);
const probe = {
  schemaVersion: 1,
  probe: {
    id: config.probeId,
    cohort: config.cohort,
    name: config.name,
    status: state.pipelineStatus,
    toolPageCount: selected.length,
    indexablePageCount: selected.length + 2,
  },
  source: dataset.source,
  seo,
  selection: {
    method: "query evidence + CI utility + manifest frequency + operating-system coverage + real version variability",
    candidateCount: allTools.length,
    selectedCount: selected.length,
    weights: config.selection.weights,
  },
  changes,
  tools: selected,
};

await writeJson(outputPath, probe);
await writeJson(join(root, "data", "changes.json"), {
  schemaVersion: 1,
  fromCommit: previousProbe?.source.commit ?? null,
  toCommit: dataset.source.commit,
  generatedAt: dataset.source.fetchedAt,
  baseline: !previousProbe,
  changes,
});

process.stdout.write(`Selected ${selected.length}/${allTools.length} eligible tools; ${changes.length} source changes detected\n`);
