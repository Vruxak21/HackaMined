/**
 * Custom HTTPS development server for Next.js.
 *
 * Usage:  npm run dev:https
 *
 * Requires mkcert certificates in certificates/:
 *   mkcert -key-file certificates/key.pem -cert-file certificates/cert.pem localhost 127.0.0.1
 *
 * Ports:
 *   3000 — HTTPS (primary)
 *   3001 — HTTP  (redirects every request to https://localhost:3000)
 */

import { createServer as createHttpsServer } from "https";
import { createServer as createHttpServer } from "http";
import { readFileSync } from "fs";
import { parse } from "url";
import next from "next";
import path from "path";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: readFileSync(path.join(process.cwd(), "certificates/key.pem")),
  cert: readFileSync(path.join(process.cwd(), "certificates/cert.pem")),
};

app.prepare().then(() => {
  // ── HTTPS server on :3000 ────────────────────────────────────────────────
  createHttpsServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  }).listen(3000, () => {
    console.log("> Ready on https://localhost:3000");
  });

  // ── HTTP server on :3001 — redirects to HTTPS ────────────────────────────
  createHttpServer((req, res) => {
    const host = req.headers.host?.replace(/:.*/, "") ?? "localhost";
    res.writeHead(301, { Location: `https://${host}:3000${req.url ?? "/"}` });
    res.end();
  }).listen(3001, () => {
    console.log("> HTTP → HTTPS redirect listening on http://localhost:3001");
  });
});
