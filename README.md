# Runner Image Index — Probe 001

Static Astro Probe generated from the official [`actions/runner-images`](https://github.com/actions/runner-images) manifests. It inverts the source from image-first inventories to one comparison page per selected tool.

## Reproducible pipeline

```bash
npm install
npm run pipeline
```

The pipeline is deliberately explicit:

```text
fetch → normalize → validate → generate → typecheck → test → build → QA
```

- `probe.config.json` defines the Probe, source and selection formula.
- `config/tool-catalog.json` is the conservative canonical-name and alias layer.
- `data/source-snapshot.json` records the source commit, licence, checksums and retrieval time.
- `data/normalized-images.json` is the normalized dataset.
- `src/data/probe.json` is the selected 30-page build input.
- `src/pages/tools/[slug].astro` is the shared page template.
- `seo.config.json` and `deploy.config.json` keep SEO and deployment concerns separate.

Set `RUNNER_IMAGES_REF` to refresh from a particular official revision. For offline verification against an already cloned official repository, set `RUNNER_IMAGES_SOURCE_DIR` to that checkout. A repeated run against the same source commit preserves `fetchedAt` and produces the same generated data.

## Deployment and Search Console

The Probe is deployed at <https://volaga17.github.io/github-actions-software-index/> from its dedicated public repository. `SITE_URL` and `BASE_PATH` configure the GitHub Pages origin; `GOOGLE_SITE_VERIFICATION` adds the Search Console verification tag. The property is verified and the sitemap is submitted. No Search Console metrics are simulated while Google processes the new property.

The site includes privacy-neutral metric hooks (`data-metric="OUTBOUND_SOURCE_CLICK"`) but does not send data to a third party. Search Console is the primary demand signal for the Probe.

## Data interpretation

“Listed” means an exact configured source name and version were found in the pinned official manifest. “Not listed” is not a claim that a tool cannot be installed during a job. Every row links to its commit-pinned source.

Third-party attribution is preserved in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
