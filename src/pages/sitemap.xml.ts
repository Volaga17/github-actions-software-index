import type { APIRoute } from "astro";
import probe from "../data/probe.json";

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error("Astro site URL is required for the sitemap");
  const paths = ["/", "/methodology/", ...probe.tools.map((tool) => `/tools/${tool.slug}/`)];
  const lastmod = probe.source.fetchedAt.split("T")[0];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
