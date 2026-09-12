import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { detectChanges, extractToolEvidence, parseManifestMetadata, parseRepositoryImageIndex } from "../scripts/lib/source-parser.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalog = JSON.parse(await readFile(join(root, "config", "tool-catalog.json"), "utf8"));
const dataset = JSON.parse(await readFile(join(root, "data", "normalized-images.json"), "utf8"));
const probe = JSON.parse(await readFile(join(root, "src", "data", "probe.json"), "utf8"));

test("parses the official image table without a hard-coded image list", () => {
  const markdown = `## Available Images
| Image | Architecture | YAML Label | Included Software |
| --- | --- | --- | --- |
| Ubuntu 24.04 | x64 | \`ubuntu-latest\` or \`ubuntu-24.04\` | [ubuntu-24.04] |

[ubuntu-24.04]: https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md
### Label scheme`;
  assert.deepEqual(parseRepositoryImageIndex(markdown), [{
    id: "ubuntu-24.04",
    name: "Ubuntu 24.04",
    architecture: "x64",
    labels: ["ubuntu-latest", "ubuntu-24.04"],
    lifecycle: "ga",
    sourcePath: "images/ubuntu/Ubuntu2404-Readme.md",
    sourceUrl: "https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md",
  }]);
});

test("removes empty lifecycle links from official image names", () => {
  const markdown = `## Available Images
| Image | Architecture | YAML Label | Included Software |
| --- | --- | --- | --- |
| Xcode 27 [](https://github.com/actions/runner-images/issues/14404) (Preview) | arm64 | \`xcode-27\` | [xcode-27-arm64] |

[xcode-27-arm64]: https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md
### Label scheme`;
  const [image] = parseRepositoryImageIndex(markdown);
  assert.equal(image.name, "Xcode 27 (Preview)");
  assert.equal(image.lifecycle, "preview");
});

test("normalizes exact source names and cached version sections", () => {
  const manifest = `# Ubuntu 24.04
- OS Version: 24.04 LTS
- Image Version: 20260907.1
### Language and Runtime
- Node.js 22.23.2
### Cached Tools
#### Node.js
- 22.23.2
- 24.20.0
### Tools
- Newman 6.2.2`;
  const definition = catalog.find((tool) => tool.slug === "nodejs");
  assert.deepEqual(parseManifestMetadata(manifest), { heading: "Ubuntu 24.04", osVersion: "24.04 LTS", imageVersion: "20260907.1" });
  assert.deepEqual(extractToolEvidence(manifest, definition), {
    available: true,
    sourceNames: ["Node.js"],
    versions: ["22.23.2", "24.20.0"],
  });
});

test("keeps aliases explicit and does not fuzzy-merge similar tools", () => {
  const node = catalog.find((tool) => tool.slug === "nodejs");
  assert.deepEqual(node.aliases, ["node", "nodejs"]);
  const evidence = extractToolEvidence("- Newman 6.2.2\n- node-exporter 1.9.1", node);
  assert.equal(evidence.available, false);
});

test("build dataset has no duplicate or empty tool pages", () => {
  assert.equal(probe.tools.length, 30);
  assert.equal(new Set(probe.tools.map((tool) => tool.slug)).size, 30);
  assert.equal(new Set(probe.tools.map((tool) => tool.canonicalName)).size, 30);
  assert.ok(probe.tools.every((tool) => tool.listedImageCount >= 2));
  assert.ok(probe.tools.every((tool) => tool.availability.some((row) => row.available && row.versions.length > 0)));
  assert.ok(dataset.images.every((image) => image.imageVersion && image.sourceUrl.includes(dataset.source.commit)));
});

test("detects when a tool disappears from an image", () => {
  const previous = {
    tools: [{ slug: "docker", availability: [{ imageId: "ubuntu", available: true, versions: ["28.0.4"] }] }],
  };
  const next = [{ slug: "docker", availability: [{ imageId: "ubuntu", available: false, versions: [] }] }];
  assert.deepEqual(detectChanges(previous, next), [
    { type: "TOOL_REMOVED_FROM_IMAGE", tool: "docker", imageId: "ubuntu" },
    { type: "VERSION_REMOVED", tool: "docker", imageId: "ubuntu", version: "28.0.4" },
  ]);
});

test("real dataset contains only official, pinned provenance", () => {
  const serialized = JSON.stringify({ dataset, probe }).toLowerCase();
  assert.equal(serialized.includes("test data"), false);
  assert.equal(serialized.includes("fixture"), false);
  for (const tool of probe.tools) {
    for (const row of tool.availability) {
      assert.match(row.sourceUrl, new RegExp(`^https://github\\.com/actions/runner-images/blob/${dataset.source.commit}/`));
    }
  }
});
