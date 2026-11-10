import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';

const FORMATS = [
  { key: 't20', label: 'T20 — 20 overs, 2 innings' },
  { key: 'odi', label: 'ODI — 50 overs, 2 innings' },
  { key: 'test', label: 'Test — unlimited overs, 4 innings' },
  { key: 'custom', label: 'Custom — your own overs' },
];

const EMPTY_RULES = {
  leagueName: '',
  pointsWin: 2,
  pointsTie: 1,
  playoffTieRule: 'table',
  defaultFormat: 't20',
  defaultOvers: 20,
  defaultPlayoffTeams: 4,
};

export default function Settings() {
  const { refresh, user } = useApp();
  const toast = useToast();
  const [rules, setRules] = useState(null);
  const [saved, setSaved] = useState(null);
  const [savingRules, setSavingRules] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api('/settings')
      .then((d) => {
        if (!alive) return;
        const next = {
          leagueName: d.leagueName,
          pointsWin: d.pointsWin,
          pointsTie: d.pointsTie,
          playoffTieRule: d.playoffTieRule,
          defaultFormat: d.defaultFormat,
          defaultOvers: d.defaultOvers,
          defaultPlayoffTeams: d.defaultPlayoffTeams,
        };
        setRules(next);
        setSaved(next);
      })
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [toast]);

  const current = rules || EMPTY_RULES;
  const dirty = saved ? JSON.stringify(current) !== JSON.stringify(saved) : false;

  const saveRules = async (e) => {
    e.preventDefault();
    setSavingRules(true);
    try {
      const next = await api('/settings', {
        method: 'PATCH',
        body: {
          leagueName: current.leagueName,
          pointsWin: Number(current.pointsWin),
          pointsTie: Number(current.pointsTie),
          playoffTieRule: current.playoffTieRule,
          defaultFormat: current.defaultFormat,
          defaultOvers: Number(current.defaultOvers),
          defaultPlayoffTeams: Number(current.defaultPlayoffTeams),
        },
      });
      const applied = {
        leagueName: next.leagueName,
        pointsWin: next.pointsWin,
        pointsTie: next.pointsTie,
        playoffTieRule: next.playoffTieRule,
        defaultFormat: next.defaultFormat,
        defaultOvers: next.defaultOvers,
        defaultPlayoffTeams: next.defaultPlayoffTeams,
      };
      setRules(applied);
      setSaved(applied);
      await refresh();
      toast('League rules saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingRules(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.newPassword !== pw.confirm) {
      setError('The new passwords do not match');
      return;
    }
    setSavingPw(true);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword },
      });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Password changed');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">League configuration</div>
          <h1>Settings</h1>
          <div className="sub">Branding, the rules the scorebook follows, and your account.</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <div className="panel-head">
            <h3>League rules</h3>
            <span className="right tiny muted">Applies to every season</span>
          </div>
          <form onSubmit={saveRules} className="panel-body stack" style={{ gap: 14 }}>
            <div className="field">
              <label>League name</label>
              <input
                className="input"
                value={current.leagueName}
                onChange={(e) => setRules({ ...current, leagueName: e.target.value })}
                required
              />
              <span className="hint">Shown across the app and on every page header.</span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Points for a win</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10}
                  value={current.pointsWin}
                  onChange={(e) => setRules({ ...current, pointsWin: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Points for a tie / no result</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10}
                  value={current.pointsTie}
                  onChange={(e) => setRules({ ...current, pointsTie: e.target.value })}
                  required
                />
              </div>
            </div>
            <span className="hint" style={{ marginTop: -6 }}>
              Takes effect for matches finished after saving; the points table reads the same values.
            </span>

            <div className="field">
              <label>Knockout match decided level</label>
              <select
                className="select"
                value={current.playoffTieRule}
                onChange={(e) => setRules({ ...current, playoffTieRule: e.target.value })}
              >
                <option value="table">Higher league position advances</option>
                <option value="replay">No winner — the match must be replayed</option>
              </select>
              <span className="hint">
                Ties, draws and no results in a playoff. With the first option the bracket keeps moving and the
                result is marked as decided on league position.
              </span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Default season format</label>
                <select
                  className="select"
                  value={current.defaultFormat}
                  onChange={(e) => setRules({ ...current, defaultFormat: e.target.value })}
                >
                  {FORMATS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Default overs (custom format)</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={900}
                  value={current.defaultOvers}
                  onChange={(e) => setRules({ ...current, defaultOvers: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="field">
              <label>Default playoff size</label>
              <select
                className="select"
                value={current.defaultPlayoffTeams}
                onChange={(e) => setRules({ ...current, defaultPlayoffTeams: Number(e.target.value) })}
              >
                <option value={2}>Top 2 — one final</option>
                <option value={4}>Top 4 — IPL style</option>
                <option value={5}>Top 5 — eliminators</option>
              </select>
              <span className="hint">New seasons start with this bracket; each season can still change it.</span>
            </div>

            <div className="row" style={{ gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={savingRules || !dirty}>
                {savingRules ? 'Saving…' : 'Save league rules'}
              </button>
              {dirty && saved ? (
                <button type="button" className="btn" onClick={() => setRules(saved)}>
                  Reset
                </button>
              ) : null}
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Your account</h3>
            <span className="right badge role">{user.username}</span>
          </div>
          <form onSubmit={savePassword} className="panel-body stack" style={{ gap: 12 }}>
            <div className="field">
              <label>Current password</label>
              <input
                className="input"
                type="password"
                value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>New password</label>
                <input
                  className="input"
                  type="password"
                  value={pw.newPassword}
                  onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input
                  className="input"
                  type="password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
            </div>
            {error ? <div className="error-text">{error}</div> : null}
            <div>
              <button type="submit" className="btn btn-primary" disabled={savingPw}>
                {savingPw ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Team logins</h3>
          </div>
          <div className="panel-body stack" style={{ gap: 10 }}>
            <p className="small muted">
              Every team can have one read-only account for their own analytics: squad contribution, player totals and
              season results. Create or reset those credentials from the Teams page.
            </p>
            <div>
              <Link className="btn" to="/teams">
                Manage team logins
              </Link>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>How the scorebook works</h3>
          </div>
          <div className="panel-body">
            <table className="sheet compact">
              <tbody>
                <tr>
                  <td className="strong">Squad</td>
                  <td>12 players per team per season</td>
                </tr>
                <tr>
                  <td className="strong">Playing XI</td>
                  <td>11 players, exactly one wicketkeeper who must be a batter</td>
                </tr>
                <tr>
                  <td className="strong">League points</td>
                  <td>
                    Win {current.pointsWin} · Tie / No result {current.pointsTie} · Loss 0
                  </td>
                </tr>
                <tr>
                  <td className="strong">Knockout ties</td>
                  <td>
                    {current.playoffTieRule === 'table'
                      ? 'Higher league position advances'
                      : 'Must be replayed — no winner awarded'}
                  </td>
                </tr>
                <tr>
                  <td className="strong">NRR</td>
                  <td>Runs per over scored minus conceded; an all-out side counts its full overs</td>
                </tr>
                <tr>
                  <td className="strong">Formats</td>
                  <td>T20 (20 ov), ODI (50 ov), Test (4 innings), Custom (any overs, 2 or 4 innings)</td>
                </tr>
                <tr>
                  <td className="strong">Declarations</td>
                  <td>Available in Test and Custom formats</td>
                </tr>
                <tr>
                  <td className="strong">Playoffs</td>
                  <td>Top 2, top 4 (IPL style) or top 5 brackets</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
