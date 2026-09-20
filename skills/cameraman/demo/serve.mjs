/** Static server for the demo pages. No dependencies — just node:http. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DEMO_PORT || 4599);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

http
  .createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = path.join(dir, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => {
    process.stdout.write(`demo na http://127.0.0.1:${port}\n`);
  });
