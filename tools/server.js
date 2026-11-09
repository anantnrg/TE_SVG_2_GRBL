import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(".");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Invalid path");
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});
server.listen(Number(process.env.PORT) || 4173, "127.0.0.1", () => console.log(`TE SVG 2 GRBL running at http://127.0.0.1:${server.address().port}`));
