import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser } from './auth.js';
import { db, ROOT_DIR } from './db.js';
import authRoutes from './routes/auth.js';
import teamRoutes from './routes/teams.js';
import seasonRoutes from './routes/seasons.js';
import matchRoutes from './routes/matches.js';
import statsRoutes from './routes/stats.js';
import importRoutes from './routes/import.js';
import backupRoutes from './routes/backup.js';

const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || (isProd ? 8080 : 5173);
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: isProd ? 'prod' : 'dev', time: new Date().toISOString() });
});

app.use('/api', authRoutes, teamRoutes, seasonRoutes, matchRoutes, statsRoutes, importRoutes, backupRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api error]', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

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

const shutdown = () => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void fileURLToPath;
