import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import app from './app.js';
import { db, ready, ROOT_DIR } from './db.js';

const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || (isProd ? 8080 : 5173);

await ready;

if (isProd) {
  const dist = path.join(ROOT_DIR, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('No production build found. Run "npm run build" first.');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.listen(PORT, () => {
    console.log(`CricVault running in production at http://localhost:${PORT}`);
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: ROOT_DIR,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  app.use('*', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
      const template = await vite.transformIndexHtml(
        req.originalUrl,
        fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8')
      );
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (err) {
      next(err);
    }
  });
  const server = app.listen(PORT, () => {
    console.log(`CricVault dev server running at http://localhost:${PORT}`);
    console.log('Admin login — username: admin   password: admin123');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other process or set PORT.`);
      process.exit(1);
    }
    throw err;
  });
}

const shutdown = async () => {
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
