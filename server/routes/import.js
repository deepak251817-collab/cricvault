import { createRouter } from '../router.js';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db, now } from '../db.js';
import { requireAdmin } from '../auth.js';

const router = createRouter();
router.use(requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (!ok) return cb(new Error('Upload an .xlsx, .xls or .csv file'));
    cb(null, true);
  },
});

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (s) => String(s ?? '').trim();

function pick(row, keys) {
  for (const key of keys) {
    const found = Object.keys(row).find((k) => norm(k) === key);
    if (found && clean(row[found]) !== '') return clean(row[found]);
  }
  return '';
}

function yes(value) {
  return ['yes', 'y', 'true', '1', 'x', '✓'].includes(clean(value).toLowerCase());
}

function normalizeRole(value) {
  const v = norm(value);
  if (['batsman', 'batter', 'bat', 'batsmen'].includes(v)) return 'batter';
  if (['bowler', 'bowling', 'bowl', 'pacebowler', 'spinner'].includes(v)) return 'bowler';
  if (['allrounder', 'allround', 'ar'].includes(v)) return 'allrounder';
  if (['wicketkeeper', 'wicketkeeperbatter', 'keeper', 'wk', 'wicketkeeperbatsman'].includes(v)) return 'wicketkeeper';
  return 'batter';
}

function normalizeStyle(value, options, fallback = null) {
  const v = norm(value);
  return options.includes(v) ? v : fallback;
}

function readSheet(file) {
  const wb = XLSX.read(file.buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('The workbook has no sheets');
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

/* ----------------------------- templates ----------------------------- */

router.get('/import/templates/:type', async (req, res) => {
  const type = req.params.type === 'teams' ? 'teams' : 'players';
  const wb = XLSX.utils.book_new();
  if (type === 'teams') {
    const rows = [
      ['Team Name', 'Short Name'],
      ['Mumbai Strikers', 'MUM'],
      ['Chennai Lions', 'CHE'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 26 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Teams');
    const help = XLSX.utils.aoa_to_sheet([
      ['How to use this template'],
      ['One team per row. Team Name and Short Name are required.'],
      ['Short Name should be 2-6 characters.'],
      ['Home ground and colour are not imported — set them with Edit on the Teams page.'],
      ['You can tick "Add to season" in the import dialog to enrol every imported team.'],
    ]);
    help['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, help, 'Instructions');
  } else {
    const rows = [
      ['Player Name', 'Role', 'Batting', 'Bowling', 'Wicketkeeper', 'Captain'],
      ['Arjun Rao', 'batter', 'right', '', '', ''],
      ['Imran Qadir', 'bowler', 'right', 'fast', '', ''],
      ['Suresh Nair', 'allrounder', 'left', 'spin', 'yes', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Players');
    const help = XLSX.utils.aoa_to_sheet([
      ['How to use this template'],
      ['Player Name is required. Everything else is optional.'],
      ['Role: batter, bowler, allrounder or wicketkeeper.'],
      ['Batting: right or left. Bowling: fast, medium or spin.'],
      ['Wicketkeeper / Captain: yes or no.'],
      ['The team and season are chosen in the import dialog, so every imported player lands in that squad.'],
      ['Leave the team on "player pool only" to add players without a team and assign them later.'],
      ['Squads are capped at 12 players per team per season.'],
    ]);
    help['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, help, 'Instructions');
  }
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cricvault-${type}-template.xlsx"`);
  res.send(buffer);
});

/* ------------------------------- import ------------------------------ */

router.post('/import/:type', upload.single('file'), async (req, res) => {
  const type = req.params.type === 'teams' ? 'teams' : 'players';
  if (!req.file) return res.status(400).json({ error: 'Choose a spreadsheet to import' });
  const dryRun = req.body?.dryRun === '1' || req.body?.dryRun === 'true';
  let rows;
  try {
    rows = readSheet(req.file);
  } catch (err) {
    return res.status(400).json({ error: `Could not read the file: ${err.message}` });
  }
  if (!rows.length) return res.status(400).json({ error: 'The sheet is empty' });
  if (rows.length > 500) return res.status(400).json({ error: 'Import at most 500 rows at a time' });

  const seasonId = Number(req.body?.seasonId || 0);
  const addToSeason = req.body?.addToSeason === '1' || req.body?.addToSeason === 'true';
  const errors = [];
  const warnings = [];
  let created = 0;
  let updated = 0;
  let squadAdded = 0;
  let skipped = 0;

  const season = seasonId ? await db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId) : null;
  if (seasonId && !season) return res.status(400).json({ error: 'Season not found' });

  // Pre-validate dialog-selected team for player imports (applies to every row).
  let importTeam = null;
  if (type !== 'teams') {
    const teamIdRaw = String(req.body?.teamId ?? '').trim();
    if (teamIdRaw) {
      if (!season) return res.status(400).json({ error: 'Choose a season before selecting a team' });
      importTeam = await db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(teamIdRaw));
      if (!importTeam) return res.status(400).json({ error: 'Selected team was not found' });
      const enrolled = await db
        .prepare('SELECT 1 FROM season_teams WHERE season_id = ? AND team_id = ?')
        .get(season.id, importTeam.id);
      if (!enrolled) return res.status(400).json({ error: `${importTeam.name} is not part of this season` });
    }
  }

  const work = db.transaction(async () => {
    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      if (type === 'teams') {
        const name = pick(row, ['teamname', 'name', 'team']);
        const shortName = pick(row, ['shortname', 'short', 'code', 'abbreviation']).toUpperCase();
        if (!name) {
          errors.push({ row: line, message: 'Team Name is required' });
          continue;
        }
        if (!shortName) {
          errors.push({ row: line, message: `${name}: Short Name is required` });
          continue;
        }
        if (shortName.length > 6) {
          errors.push({ row: line, message: `${name}: Short Name must be 6 characters or fewer` });
          continue;
        }
        const byName = await db.prepare('SELECT * FROM teams WHERE name = ? COLLATE NOCASE').get(name);
        const byShort = await db.prepare('SELECT * FROM teams WHERE short_name = ? COLLATE NOCASE').get(shortName);
        if (byName) {
          if (byShort && byShort.id !== byName.id) {
            errors.push({ row: line, message: `${name}: Short Name ${shortName} belongs to another team` });
            continue;
          }
          if (!dryRun) {
            await db.prepare('UPDATE teams SET short_name = ?, is_active = 1 WHERE id = ?').run(shortName, byName.id);
          }
          updated += 1;
          if ((addToSeason || seasonId) && seasonId) {
            const exists = await db.prepare('SELECT 1 FROM season_teams WHERE season_id = ? AND team_id = ?').get(seasonId, byName.id);
            if (!exists && !dryRun) {
              await db.prepare('INSERT INTO season_teams (season_id, team_id, added_at) VALUES (?,?,?)').run(seasonId, byName.id, now());
            }
          }
          continue;
        }
        if (byShort) {
          errors.push({ row: line, message: `${name}: Short Name ${shortName} is already used by ${byShort.name}` });
          continue;
        }
        if (dryRun) {
          created += 1;
          continue;
        }
        const info = await db
          .prepare('INSERT INTO teams (name, short_name, color, is_active, created_at) VALUES (?,?,?,1,?)')
          .run(name, shortName, '#2f6b3f', now());
        if ((addToSeason || seasonId) && seasonId) {
          await db.prepare('INSERT OR IGNORE INTO season_teams (season_id, team_id, added_at) VALUES (?,?,?)').run(seasonId, info.lastInsertRowid, now());
        }
        created += 1;
        continue;
      }

      // players
      const name = pick(row, ['playername', 'name', 'player']);
      if (!name) {
        errors.push({ row: line, message: 'Player Name is required' });
        continue;
      }
      // Team and season are chosen in the import dialog (not read from spreadsheet rows).
      const targetSeason = season;
      const team = importTeam;

      const role = normalizeRole(pick(row, ['role', 'playertype', 'type']));
      const batting = normalizeStyle(pick(row, ['batting', 'battingstyle', 'bats']), ['right', 'left'], null);
      const bowling = normalizeStyle(pick(row, ['bowling', 'bowlingstyle', 'bowl']), ['fast', 'medium', 'spin'], null);
      const isKeeper = yes(pick(row, ['wicketkeeper', 'keeper', 'wk']));

      let player = await db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
      if (player && targetSeason && team) {
        const inSquad = await db
          .prepare('SELECT * FROM season_players WHERE season_id = ? AND player_id = ?')
          .get(targetSeason.id, player.id);
        if (inSquad) {
          const label = inSquad.team_id === team.id ? 'already in this squad' : 'already in another squad this season';
          errors.push({ row: line, message: `${name}: ${label}` });
          continue;
        }
      }

      if (!dryRun) {
        if (player) {
          await db.prepare('UPDATE players SET role = ?, batting_style = COALESCE(?, batting_style), bowl_style = COALESCE(?, bowl_style), is_active = 1 WHERE id = ?').run(
            role,
            batting,
            bowling,
            player.id
          );
          updated += 1;
        } else {
          const info = await db
            .prepare('INSERT INTO players (name, role, bowl_style, batting_style, is_active, created_at) VALUES (?,?,?,?,1,?)')
            .run(name, role, bowling, batting, now());
          player = { id: info.lastInsertRowid };
          created += 1;
        }
      } else {
        created += 1;
        if (!player) player = { id: null };
      }

      if (targetSeason && team) {
        const count = (await db
          .prepare('SELECT COUNT(*) AS n FROM season_players WHERE season_id = ? AND team_id = ?')
          .get(targetSeason.id, team.id)).n;
        if (count >= 12) {
          errors.push({ row: line, message: `${name}: ${team.name} already has 12 players this season` });
          skipped += 1;
          continue;
        }
        // Bowlers and all-rounders cannot keep, whatever the sheet says.
        const keeperFlag = Boolean(isKeeper || role === 'wicketkeeper') && ['batter', 'wicketkeeper'].includes(role);
        if (isKeeper && !keeperFlag) {
          warnings.push({ row: line, message: `${name}: only a batter can be a wicketkeeper — imported without the glove` });
        }
        if (!dryRun) {
          await db.prepare(
            'INSERT INTO season_players (season_id, team_id, player_id, is_captain, is_wicketkeeper, added_at) VALUES (?,?,?,?,?,?)'
          ).run(targetSeason.id, team.id, player.id, 0, keeperFlag ? 1 : 0, now());
          // Flagged as a keeper means they are a keeper, whatever column said batter.
          if (keeperFlag) {
            await db.prepare("UPDATE players SET role = 'wicketkeeper' WHERE id = ? AND role = 'batter'").run(player.id);
          }
        }
        squadAdded += 1;
      }
    }
    if (dryRun) throw Object.assign(new Error('__dry_run__'), { dryRun: true });
  });

  try {
    await work();
  } catch (err) {
    if (!err.dryRun) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.json({ type, dryRun, created, updated, squadAdded, skipped, errors, warnings, rows: rows.length });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 8 MB' : err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

export default router;
