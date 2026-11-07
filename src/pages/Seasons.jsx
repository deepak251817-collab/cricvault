import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Empty, Modal, Spinner, StatusBadge, formatDate } from '../ui.jsx';

const FORMATS = [
  { key: 't20', label: 'T20' },
  { key: 'odi', label: 'ODI' },
  { key: 'test', label: 'Test' },
  { key: 'custom', label: 'Custom' },
];

function NewSeason({ onClose, onCreated }) {
  const { teams, refresh } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    format: 't20',
    oversPerInnings: 20,
    inningsLimit: 2,
    playoffTeams: 4,
    startsOn: '',
    notes: '',
    teamIds: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggleTeam = (id) => {
    setForm((f) => ({
      ...f,
      teamIds: f.teamIds.includes(id) ? f.teamIds.filter((t) => t !== id) : [...f.teamIds, id],
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Give the season a name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api('/seasons', {
        method: 'POST',
        body: {
          ...form,
          name: form.name.trim(),
          oversPerInnings: form.format === 'custom' ? Number(form.oversPerInnings) : undefined,
          inningsLimit: form.format === 'custom' ? Number(form.inningsLimit) : undefined,
        },
      });
      await refresh();
      toast(`${created.name} created`);
      onCreated(created.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New season"
      subtitle="Each season keeps its own teams, squads, fixtures and records."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="season-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create season'}
          </button>
        </>
      }
    >
      <form id="season-form" onSubmit={submit} className="form-grid">
        <div className="field full">
          <label>Season name</label>
          <input
            className="input"
            placeholder="e.g. 2026 Premier Season"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </div>

        <div className="field full">
          <label>Format</label>
          <div className="seg">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={form.format === f.key ? 'on' : ''}
                onClick={() =>
                  setForm({
                    ...form,
                    format: f.key,
                    oversPerInnings: f.key === 't20' ? 20 : f.key === 'odi' ? 50 : f.key === 'test' ? 0 : 20,
                    inningsLimit: f.key === 'test' ? 4 : 2,
                  })
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="hint">
            {form.format === 't20' && '20 overs per innings · 2 innings'}
            {form.format === 'odi' && '50 overs per innings · 2 innings'}
            {form.format === 'test' && 'Unlimited overs · 4 innings · declarations allowed'}
            {form.format === 'custom' && 'Set your own overs · declarations allowed'}
          </span>
        </div>

        {form.format === 'custom' ? (
          <>
            <div className="field">
              <label>Overs per innings</label>
              <input
                className="input"
                type="number"
                min="0"
                max="900"
                value={form.oversPerInnings}
                onChange={(e) => setForm({ ...form, oversPerInnings: e.target.value })}
              />
              <span className="hint">Leave at 0 for unlimited overs until all out.</span>
            </div>
            <div className="field">
              <label>Innings</label>
              <select
                className="select"
                value={form.inningsLimit}
                onChange={(e) => setForm({ ...form, inningsLimit: Number(e.target.value) })}
              >
                <option value={2}>2 innings</option>
                <option value={4}>4 innings</option>
              </select>
            </div>
          </>
        ) : null}

        <div className="field">
          <label>Playoff format</label>
          <select
            className="select"
            value={form.playoffTeams}
            onChange={(e) => setForm({ ...form, playoffTeams: Number(e.target.value) })}
          >
            <option value={2}>Top 2 — straight final</option>
            <option value={4}>Top 4 — IPL style (Q1, Eliminator, Q2, Final)</option>
            <option value={5}>Top 5 — Eliminator round, Q1, Q2, Final</option>
          </select>
        </div>
        {form.format !== 'custom' ? (
          <div className="field">
            <label>Start date (optional)</label>
            <input
              className="input"
              type="date"
              value={form.startsOn}
              onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
            />
          </div>
        ) : null}

        <div className="field full">
          <label>Teams in this season</label>
          {teams.length ? (
            <div className="pick-grid" style={{ maxHeight: 190 }}>
              {teams.map((team) => (
                <label key={team.id} className={`pick ${form.teamIds.includes(team.id) ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={form.teamIds.includes(team.id)}
                    onChange={() => toggleTeam(team.id)}
                    style={{ accentColor: 'var(--amber)' }}
                  />
                  <Crest team={team} size={20} />
                  <span>{team.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <span className="hint">No teams yet — you can add teams later on the Teams page.</span>
          )}
          <span className="hint">Teams added here only affect this season and future ones. Past seasons stay intact.</span>
        </div>

        <div className="field full">
          <label>Notes</label>
          <textarea
            className="textarea"
            placeholder="Optional — rules, registration notes, anything the league needs."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </form>
    </Modal>
  );
}

function RestoreSeason({ onClose, onRestored }) {
  const toast = useToast();
  const [backup, setBackup] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (event) => {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setError('');
    try {
      const parsed = JSON.parse(await chosen.text());
      if (parsed?.kind !== 'season-backup' || !parsed.season) {
        throw new Error('That file is not a CricVault season backup');
      }
      setBackup(parsed);
      setFileName(chosen.name);
    } catch (err) {
      setBackup(null);
      setFileName('');
      setError(err instanceof SyntaxError ? 'That file is not valid JSON' : err.message);
    }
  };

  const restore = async () => {
    if (!backup) {
      setError('Choose a backup file first');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api('/seasons/restore', { method: 'POST', body: { backup } });
      toast(
        `Restored ${res.name} — ${res.counts.matches} matches and ${res.counts.deliveries} balls back in place`
      );
      onRestored(res.seasonId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Restore a season backup"
      subtitle="Rebuild a deleted or damaged season from an exported .json file"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={restore} disabled={busy || !backup}>
            {busy ? 'Restoring…' : 'Restore season'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Backup file</label>
          <input className="input" type="file" accept=".json,application/json" onChange={pick} />
          <span className="sub">Exported from a season page with “Export backup”.</span>
        </div>
        {backup ? (
          <div className="field full">
            <div className="hint">
              <strong>{backup.season.name}</strong> · {backup.counts?.matches ?? 0} matches ·{' '}
              {backup.counts?.deliveries ?? 0} balls · {backup.counts?.teams ?? 0} teams
              {backup.exportedAt ? ` · exported ${formatDate(backup.exportedAt)}` : ''}
              {fileName ? ` · ${fileName}` : ''}
            </div>
            <div className="hint">
              It is restored as a new season named “{backup.season.name} (restored)”, so the current archive is never
              overwritten. Teams and players that already exist are reused, not duplicated.
            </div>
          </div>
        ) : null}
        {error ? <div className="error-text full">{error}</div> : null}
      </div>
    </Modal>
  );
}

export default function Seasons() {
  const { user, refresh } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [seasons, setSeasons] = useState(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = () =>
    api('/seasons')
      .then(setSeasons)
      .catch((err) => toast(err.message, 'error'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!seasons) return <Spinner label="Opening the archive" />;

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">Competitions</div>
          <h1>Seasons</h1>
          <div className="sub">
            Every season is a sealed archive: its teams, squads, results and awards never change when the league moves on.
          </div>
        </div>
        {user.role === 'admin' ? (
          <div className="page-actions">
            <button type="button" className="btn" onClick={() => setRestoring(true)}>
              Restore backup
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              + New season
            </button>
          </div>
        ) : null}
      </div>

      {!seasons.length ? (
        <div className="panel">
          <Empty title="No seasons yet">
            Create your first season, pick the format and enroll the teams.
          </Empty>
        </div>
      ) : (
        <div className="grid cols-2">
          {seasons.map((s) => (
            <Link key={s.id} className="panel" to={`/seasons/${s.id}`} style={{ display: 'block' }}>
              <div className="panel-head">
                <h3>{s.name}</h3>
                <div className="right row" style={{ gap: 6 }}>
                  <span className="badge role">{s.formatLabel}</span>
                  <StatusBadge status={s.status} />
                </div>
              </div>
              <div className="panel-body">
                <div className="row wrap spread">
                  <div>
                    <div className="tiny muted" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      Teams
                    </div>
                    <div className="display" style={{ fontSize: 26 }}>
                      {s.team_count}
                    </div>
                  </div>
                  <div>
                    <div className="tiny muted" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      Matches
                    </div>
                    <div className="display" style={{ fontSize: 26 }}>
                      {s.completed_count}
                      <span style={{ color: 'var(--muted)', fontSize: 15 }}> / {s.match_count}</span>
                    </div>
                  </div>
                  <div>
                    <div className="tiny muted" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      Starts
                    </div>
                    <div className="small" style={{ marginTop: 6 }}>
                      {s.starts_on ? formatDate(s.starts_on) : 'Not set'}
                    </div>
                  </div>
                  <div className="right">
                    <div className="tiny muted" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      Champion
                    </div>
                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 3 }}>
                      {s.winner_name ? (
                        <>
                          <Crest team={{ short_name: s.winner_short, name: s.winner_name, color: s.winner_color }} size={20} />
                          <b className="small">{s.winner_short}</b>
                        </>
                      ) : (
                        <span className="small muted">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="panel-foot">
                <span>{s.playoff_teams ? `Top ${s.playoff_teams} playoffs` : 'No playoffs'}</span>
                <span style={{ marginLeft: 'auto' }}>Open season →</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating ? (
        <NewSeason
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            load();
            refresh();
            navigate(`/seasons/${id}`);
          }}
        />
      ) : null}

      {restoring ? (
        <RestoreSeason
          onClose={() => setRestoring(false)}
          onRestored={(id) => {
            setRestoring(false);
            load();
            refresh();
            navigate(`/seasons/${id}`);
          }}
        />
      ) : null}
    </>
  );
}
