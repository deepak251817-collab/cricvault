import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Empty, Modal, Spinner } from '../ui.jsx';
import ImportDialog from '../components/ImportDialog.jsx';

function TeamForm({ team, onClose, onSaved }) {
  const { seasons } = useApp();
  const toast = useToast();
  const editing = !!team;
  const [form, setForm] = useState({
    name: team?.name || '',
    shortName: team?.short_name || '',
    color: team?.color || '#2f6b3f',
    homeGround: team?.home_ground || '',
    seasonId: '',
    username: '',
    password: '',
    isActive: team ? !!team.is_active : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api(`/teams/${team.id}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            shortName: form.shortName,
            color: form.color,
            homeGround: form.homeGround,
            isActive: form.isActive,
          },
        });
        toast('Team updated');
      } else {
        const created = await api('/teams', {
          method: 'POST',
          body: {
            name: form.name,
            shortName: form.shortName,
            color: form.color,
            homeGround: form.homeGround,
            seasonId: form.seasonId || undefined,
          },
        });
        if (form.username && form.password) {
          await api(`/teams/${created.id}/credentials`, {
            method: 'POST',
            body: { username: form.username, password: form.password },
          });
        }
        toast(`${created.name} added`);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${team.name}` : 'New team'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="team-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save team' : 'Create team'}
          </button>
        </>
      }
    >
      <form id="team-form" onSubmit={submit} className="form-grid">
        <div className="field full">
          <label>Team name</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Mumbai Strikers"
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label>Short name</label>
          <input
            className="input"
            value={form.shortName}
            onChange={(e) => setForm({ ...form, shortName: e.target.value.toUpperCase() })}
            placeholder="MUM"
            maxLength={6}
            required
          />
        </div>
        <div className="field">
          <label>Team colour</label>
          <div className="row">
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              style={{ width: 42, height: 38, border: '1px solid var(--line-strong)', background: '#fff' }}
            />
            <input className="input" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>
        </div>
        <div className="field full">
          <label>Home ground</label>
          <input
            className="input"
            value={form.homeGround}
            onChange={(e) => setForm({ ...form, homeGround: e.target.value })}
            placeholder="Wankhede Oval"
          />
        </div>

        {!editing ? (
          <>
            <div className="field full">
              <label>Enrol in season (optional)</label>
              <select
                className="select"
                value={form.seasonId}
                onChange={(e) => setForm({ ...form, seasonId: e.target.value })}
              >
                <option value="">Do not add to a season yet</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="hint">Only this season and future ones are affected — past seasons keep their teams.</span>
            </div>
            <div className="field">
              <label>Team login (optional)</label>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="username"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="min 6 characters"
                autoComplete="new-password"
              />
            </div>
          </>
        ) : (
          <label className="check full">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active — show this team in current and future seasons
          </label>
        )}

        {error ? <div className="error-text full">{error}</div> : null}
      </form>
    </Modal>
  );
}

function Credentials({ team, onClose }) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [existing, setExisting] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/teams/${team.id}/credentials`)
      .then((data) => {
        setExisting(data.user);
        if (data.user) setUsername(data.user.username);
        else setUsername(team.short_name.toLowerCase());
      })
      .catch((err) => setError(err.message));
  }, [team]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/teams/${team.id}/credentials`, { method: 'POST', body: { username, password } });
      toast(existing ? 'Team login updated' : 'Team login created');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${team.short_name} team login`}
      subtitle="Team accounts can only view their own squad analytics and the league's public records."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="cred-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Reset password' : 'Create login'}
          </button>
        </>
      }
    >
      <form id="cred-form" onSubmit={submit} className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label>Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label>{existing ? 'New password' : 'Password'}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={existing ? 'Leave blank to keep the current password' : 'At least 6 characters'}
            required={!existing}
            autoComplete="new-password"
          />
        </div>
        {error ? <div className="error-text">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function Teams() {
  const toast = useToast();
  const [teams, setTeams] = useState(null);
  const [form, setForm] = useState(null);
  const [creds, setCreds] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = () =>
    api('/teams?all=1')
      .then(setTeams)
      .catch((err) => toast(err.message, 'error'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeTeam = async (team) => {
    const ok = window.confirm(
      `Delete ${team.name}?\n\n` +
        'A team with squads or fixtures in a season is archived instead, so past scorecards stay intact. ' +
        'A team nothing refers to is deleted permanently.'
    );
    if (!ok) return;
    try {
      const res = await api(`/teams/${team.id}`, { method: 'DELETE' });
      toast(res.archived ? `${team.name} archived — it still appears in past scorecards` : `${team.name} deleted`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const restoreTeam = async (team) => {
    try {
      await api(`/teams/${team.id}`, { method: 'PATCH', body: { isActive: true } });
      toast(`${team.name} restored to the active teams`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!teams) return <Spinner label="Loading teams" />;

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">Franchises</div>
          <h1>Teams</h1>
          <div className="sub">
            Teams live across seasons. Deleting a team that has history archives it instead, so past seasons and scorecards never change.
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            Import teams
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setForm({ mode: 'create' })}>
            + New team
          </button>
        </div>
      </div>

      {!teams.length ? (
        <div className="panel">
          <Empty title="No teams yet">Create your first franchise, or import a list from Excel.</Empty>
        </div>
      ) : (
        <div className="grid cols-3">
          {teams.map((team) => (
            <div key={team.id} className="panel" style={{ borderTop: `3px solid ${team.color}` }}>
              <div className="panel-body">
                <div className="row" style={{ gap: 12, marginBottom: 12 }}>
                  <Crest team={team} size={42} />
                  <div style={{ minWidth: 0 }}>
                    <div className="display" style={{ fontSize: 21, letterSpacing: '0.03em' }}>
                      {team.name}
                    </div>
                    <div className="tiny muted">
                      {team.short_name} {team.home_ground ? `· ${team.home_ground}` : ''}
                    </div>
                  </div>
                  {!team.is_active ? <span className="badge" style={{ marginLeft: 'auto' }}>Archived</span> : null}
                </div>
                <div className="row spread" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <div>
                    <div className="tiny muted display" style={{ letterSpacing: '0.14em' }}>
                      Titles
                    </div>
                    <div className="display" style={{ fontSize: 22 }}>
                      {team.titles}
                    </div>
                  </div>
                  <div>
                    <div className="tiny muted display" style={{ letterSpacing: '0.14em' }}>
                      Seasons
                    </div>
                    <div className="display" style={{ fontSize: 22 }}>
                      {team.seasonCount}
                    </div>
                  </div>
                  <div>
                    <div className="tiny muted display" style={{ letterSpacing: '0.14em' }}>
                      Squad pool
                    </div>
                    <div className="display" style={{ fontSize: 22 }}>
                      {team.playerCount}
                    </div>
                  </div>
                </div>
              </div>
              <div className="panel-foot">
                <Link className="btn btn-sm" to={`/teams/${team.id}`}>
                  Open
                </Link>
                <button type="button" className="btn btn-sm" onClick={() => setForm({ mode: 'edit', team })}>
                  Edit
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setCreds(team)}>
                  Login
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => (team.is_active ? removeTeam(team) : restoreTeam(team))}
                >
                  {team.is_active ? 'Delete' : 'Restore'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form ? (
        <TeamForm
          team={form.mode === 'edit' ? form.team : null}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      ) : null}

      {creds ? <Credentials team={creds} onClose={() => setCreds(null)} /> : null}
      {importing ? (
        <ImportDialog
          type="teams"
          onClose={() => setImporting(false)}
          onDone={() => {
            load();
          }}
        />
      ) : null}
    </>
  );
}
