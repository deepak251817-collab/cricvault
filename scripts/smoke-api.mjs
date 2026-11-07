const BASE = process.env.BASE || 'http://localhost:5174';
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const login = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
check('login', login.status === 200 && login.body.user?.role === 'admin', `status ${login.status}`);

const bootstrap = await call('GET', '/api/bootstrap');
check(
  'bootstrap',
  bootstrap.status === 200 && Array.isArray(bootstrap.body.seasons) && bootstrap.body.seasons.length === 1,
  `seasons ${bootstrap.body.seasons?.length}`
);

const teams = await call('GET', '/api/teams');
check('teams', teams.status === 200 && teams.body.length === 10, `count ${teams.body?.length}`);

const seasonId = bootstrap.body.seasons[0]?.id;
const season = await call('GET', `/api/seasons/${seasonId}`);
check('season detail', season.status === 200 && season.body.season?.id === seasonId, `status ${season.status}`);

const players = await call('GET', `/api/players?seasonId=${seasonId}`);
check('players by season', players.status === 200 && Array.isArray(players.body), `rows ${players.body?.length}`);

const overview = await call('GET', '/api/stats/overview');
check(
  'stats overview',
  overview.status === 200 && overview.body.counts?.players === 12 && Array.isArray(overview.body.seasons),
  `players ${overview.body.counts?.players}`
);

const boards = await call('GET', '/api/stats/leaderboards?limit=5');
check('stats leaderboards', boards.status === 200 && Array.isArray(boards.body.batting), `status ${boards.status}`);

const records = await call('GET', '/api/stats/records');
check('stats records', records.status === 200 && Array.isArray(records.body.seasonAwards), `status ${records.status}`);

const points = await call('GET', `/api/seasons/${seasonId}/points`);
check('points table', points.status === 200 && Array.isArray(points.body), `status ${points.status}`);

const awards = await call('GET', `/api/seasons/${seasonId}/awards`);
check('season awards', awards.status === 200, `status ${awards.status}`);

const teamId = teams.body[0]?.id;
const analytics = await call('GET', `/api/teams/${teamId}/analytics`);
check('team analytics', analytics.status === 200 && analytics.body.team?.id === teamId, `status ${analytics.status}`);

const teamSeasons = await call('GET', `/api/teams/${teamId}/seasons`);
check('team seasons', teamSeasons.status === 200 && Array.isArray(teamSeasons.body), `rows ${teamSeasons.body?.length}`);

const player = await call('GET', `/api/players/${players.body?.[0]?.id}`);
check('player career', player.status === 200 && player.body.player?.id, `status ${player.status}`);

const settings = await call('GET', '/api/settings');
check('settings', settings.status === 200 && settings.body.leagueName === 'The Cricket League', `status ${settings.status}`);

const matches = await call('GET', '/api/matches');
check('matches list', matches.status === 200 && Array.isArray(matches.body), `rows ${matches.body?.length}`);

const exportRes = await call('GET', `/api/seasons/${seasonId}/export`);
check(
  'season export',
  exportRes.status === 200 && exportRes.body.season?.id === seasonId && Array.isArray(exportRes.body.teams),
  `teams ${exportRes.body.teams?.length}`
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
