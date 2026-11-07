import app from '../server/app.js';
import { ready } from '../server/db.js';

// Schema + seed run once per cold start; the promise is reused by every request.
await ready;

export default function handler(req, res) {
  // Vercel may hand the function the rewritten path, so make sure Express sees /api/...
  if (!req.url.startsWith('/api')) req.url = `/api${req.url}`;
  return app(req, res);
}
