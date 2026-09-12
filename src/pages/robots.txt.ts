import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error("Astro site URL is required for robots.txt");
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", site).href}\n`, {
    headers: { "Content-Type": "text/plain" },
  });
};
