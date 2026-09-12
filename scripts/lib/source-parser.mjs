const VERSION_PATTERN = /\bv?\d+(?:\.\d+)+(?:p\d+)?(?:[-+][0-9A-Za-z.-]+)?\b/g;

export function stripMarkdown(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?\s*>.*/i, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRepositoryImageIndex(markdown) {
  const references = new Map();
  for (const match of markdown.matchAll(/^\[([^\]]+)\]:\s+(https:\/\/github\.com\/actions\/runner-images\/blob\/main\/(.+))$/gmi)) {
    references.set(match[1].toLowerCase(), { url: match[2], path: match[3] });
  }

  const section = markdown.split("## Available Images")[1]?.split("### Label scheme")[0] ?? "";
  const images = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|") || line.includes("---") || line.includes("Architecture")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 4) continue;
    const sourceReference = cells[3].match(/\[([^\]]+)\]/)?.[1];
    const source = sourceReference ? references.get(sourceReference.toLowerCase()) : null;
    if (!source) continue;

    const labels = [...cells[2].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const lifecycle = /deprecated/i.test(cells[0]) ? "deprecated" : /preview/i.test(cells[0]) ? "preview" : "ga";
    const name = stripMarkdown(cells[0]);
    images.push({
      id: sourceReference.toLowerCase(),
      name,
      architecture: stripMarkdown(cells[1]),
      labels,
      lifecycle,
      sourcePath: source.path,
      sourceUrl: source.url,
    });
  }
  return images;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractVersions(value) {
  return [...new Set((value.match(VERSION_PATTERN) ?? []).map((version) => version.replace(/^v(?=\d)/, "")))];
}

export function extractToolEvidence(markdown, definition) {
  const sourceNames = new Set();
  const versions = new Set();

  for (const sourceName of definition.sourceNames) {
    const pattern = new RegExp(`^-\\s+${escapeRegExp(sourceName)}(?:\\s*:\\s*|\\s+)(.+)$`, "gim");
    for (const match of markdown.matchAll(pattern)) {
      sourceNames.add(sourceName);
      for (const version of extractVersions(match[1])) versions.add(version);
    }
  }

  for (const sectionName of definition.sectionNames) {
    const lines = markdown.split("\n");
    const headingIndex = lines.findIndex((line) => new RegExp(`^#{3,4}\\s+${escapeRegExp(sectionName)}\\s*$`, "i").test(line));
    if (headingIndex < 0) continue;
    const headingLevel = lines[headingIndex].match(/^#+/)?.[0].length ?? 3;
    sourceNames.add(sectionName);
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
      const nextHeadingLevel = lines[index].match(/^#+/)?.[0].length;
      if (nextHeadingLevel && nextHeadingLevel <= headingLevel) break;
      if (/^-\s+/.test(lines[index])) {
        for (const version of extractVersions(lines[index])) versions.add(version);
      }
      if (!lines[index].startsWith("|")) continue;
      const firstCell = lines[index].split("|")[1]?.replace(/[/*`_]/g, "").trim() ?? "";
      if (/^-+$/.test(firstCell)) continue;
      for (const version of extractVersions(firstCell)) versions.add(version);
    }
  }

  return {
    available: sourceNames.size > 0 && versions.size > 0,
    sourceNames: [...sourceNames].sort(),
    versions: [...versions].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
  };
}

export function parseManifestMetadata(markdown) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const osVersion = markdown.match(/^- OS Version:\s*(.+)$/m)?.[1]?.trim();
  const imageVersion = markdown.match(/^- Image Version:\s*(.+)$/m)?.[1]?.trim();
  if (!heading || !osVersion || !imageVersion) {
    throw new Error("Manifest is missing heading, OS Version, or Image Version");
  }
  return { heading, osVersion, imageVersion };
}

export function detectChanges(previousProbe, nextTools) {
  if (!previousProbe) return [];
  const previousTools = new Map(previousProbe.tools.map((tool) => [tool.slug, tool]));
  const changes = [];
  for (const tool of nextTools) {
    const previous = previousTools.get(tool.slug);
    if (!previous) {
      changes.push({ type: "TOOL_ADDED", tool: tool.slug });
      continue;
    }
    const priorRows = new Map(previous.availability.map((row) => [row.imageId, row]));
    for (const row of tool.availability) {
      const prior = priorRows.get(row.imageId);
      if (!prior && row.available) changes.push({ type: "TOOL_ADDED_TO_IMAGE", tool: tool.slug, imageId: row.imageId });
      if (prior?.available && !row.available) changes.push({ type: "TOOL_REMOVED_FROM_IMAGE", tool: tool.slug, imageId: row.imageId });
      const oldVersions = new Set(prior?.versions ?? []);
      const newVersions = new Set(row.versions);
      for (const version of newVersions) if (!oldVersions.has(version)) changes.push({ type: "VERSION_ADDED", tool: tool.slug, imageId: row.imageId, version });
      for (const version of oldVersions) if (!newVersions.has(version)) changes.push({ type: "VERSION_REMOVED", tool: tool.slug, imageId: row.imageId, version });
    }
  }
  return changes;
}
