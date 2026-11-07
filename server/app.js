import express from 'express';
import cookieParser from 'cookie-parser';
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import teamRoutes from './routes/teams.js';
import seasonRoutes from './routes/seasons.js';
import matchRoutes from './routes/matches.js';
import statsRoutes from './routes/stats.js';
import importRoutes from './routes/import.js';
import backupRoutes from './routes/backup.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: process.env.NODE_ENV === 'production' ? 'prod' : 'dev', time: new Date().toISOString() });
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

export default app;
