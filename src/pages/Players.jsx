import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Empty, Modal, RoleBadge, Spinner } from '../ui.jsx';
import ImportDialog from '../components/ImportDialog.jsx';

const ROLES = [
  { key: 'all', label: 'All' },
  { key: 'batter', label: 'Batters' },
  { key: 'bowler', label: 'Bowlers' },
  { key: 'allrounder', label: 'All-rounders' },
  { key: 'wicketkeeper', label: 'Keepers' },
];

function PlayerForm({ player, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!player;
  const [form, setForm] = useState({
    name: player?.name || '',
    role: player?.role || 'batter',
    battingStyle: player?.batting_style || '',
    bowlStyle: player?.bowl_style || '',
    isActive: player ? !!player.is_active : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api(`/players/${player.id}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            role: form.role,
            battingStyle: form.battingStyle || null,
            bowlStyle: form.bowlStyle || null,
            isActive: form.isActive,
          },
        });
        toast('Player updated');
      } else {
        await api('/players', {
          method: 'POST',
          body: {
            name: form.name,
            role: form.role,
            battingStyle: form.battingStyle || undefined,
            bowlStyle: form.bowlStyle || undefined,
          },
        });
        toast(`${form.name} added to the player pool`);
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
      title={editing ? `Edit ${player.name}` : 'New player'}
      subtitle={editing ? undefined : 'Players join a squad from the season page. This adds them to the league pool.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="player-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save player' : 'Add player'}
          </button>
        </>
      }
    >
      <form id="player-form" onSubmit={submit} className="form-grid">
        <div className="field full">
          <label>Full name</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="batter">Batter</option>
            <option value="bowler">Bowler</option>
            <option value="allrounder">All-rounder</option>
            <option value="wicketkeeper">Wicketkeeper</option>
          </select>
        </div>
        <div className="field">
          <label>Batting style</label>
          <select
            className="select"
            value={form.battingStyle}
            onChange={(e) => setForm({ ...form, battingStyle: e.target.value })}
          >
            <option value="">Not set</option>
            <option value="right">Right handed</option>
            <option value="left">Left handed</option>
          </select>
        </div>
        <div className="field">
          <label>Bowling style</label>
          <select className="select" value={form.bowlStyle} onChange={(e) => setForm({ ...form, bowlStyle: e.target.value })}>
            <option value="">Does not bowl</option>
            <option value="fast">Fast</option>
            <option value="medium">Medium</option>
            <option value="spin">Spin</option>
          </select>
        </div>
        {editing ? (
          <label className="check">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active player
          </label>
        ) : null}
        {error ? <div className="error-text full">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function Players() {
  const { teams } = useApp();
  const toast = useToast();
  const [players, setPlayers] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [teamId, setTeamId] = useState('all');
  const [form, setForm] = useState(null);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = () =>
    api('/players?all=1')
      .then(setPlayers)
      .catch((err) => toast(err.message, 'error'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!players) return [];
    const needle = q.trim().toLowerCase();
    return players.filter((p) => {
      if (role !== 'all' && p.role !== role) return false;
      if (teamId !== 'all' && String(p.team_id) !== String(teamId)) {
        const team = teams.find((t) => String(t.id) === String(teamId));
        if (!team || p.team_name !== team.name) return false;
      }
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [players, q, role, teamId, teams]);

  const filteredIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  const toggleOne = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });

  const removeSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = window.confirm(
      `Delete ${ids.length} selected player${ids.length === 1 ? '' : 's'}?\n\n` +
        'Players who have appeared in a squad, XI or scorecard are archived instead, so the records stay intact. ' +
        'Players nothing refers to are deleted permanently.'
    );
    if (!ok) return;
    setBulkBusy(true);
    try {
      const res = await api('/players/bulk-delete', { method: 'POST', body: { ids } });
      const parts = [];
      if (res.deleted) parts.push(`${res.deleted} deleted`);
      if (res.archived) parts.push(`${res.archived} archived`);
      if (res.missing) parts.push(`${res.missing} already gone`);
      toast(parts.join(' · ') || 'Nothing to delete', res.deleted || res.archived ? undefined : 'error');
      setSelected(new Set());
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const removePlayer = async (player) => {
    const ok = window.confirm(
      `Delete ${player.name}?\n\n` +
        'A player who has appeared in a squad, XI or scorecard is archived instead, so the records stay intact. ' +
        'A player nothing refers to is deleted permanently.'
    );
    if (!ok) return;
    try {
      const res = await api(`/players/${player.id}`, { method: 'DELETE' });
      toast(res.archived ? `${player.name} archived — scorecards keep their record` : `${player.name} deleted`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const restorePlayer = async (player) => {
    try {
      await api(`/players/${player.id}`, { method: 'PATCH', body: { isActive: true } });
      toast(`${player.name} restored to the player pool`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!players) return <Spinner label="Loading players" />;

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">Player pool</div>
          <h1>Players</h1>
          <div className="sub">
            Every cricketer in the league. Assign them to a team's 12-player season squad from the season page.
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            Import players
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setForm({})}>
            + New player
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <input
            className="input"
            placeholder="Search players…"
            style={{ maxWidth: 260 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="seg">
            {ROLES.map((r) => (
              <button key={r.key} type="button" className={role === r.key ? 'on' : ''} onClick={() => setRole(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          <select
            className="select right"
            style={{ width: 180, marginLeft: 'auto' }}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="panel-body flush">
          {selected.size ? (
            <div className="bulk-bar">
              <span className="small">
                <strong>{selected.size}</strong> selected
              </span>
              <button type="button" className="btn btn-sm btn-danger" onClick={removeSelected} disabled={bulkBusy}>
                {bulkBusy ? 'Deleting…' : `Delete ${selected.size} selected`}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          ) : null}
          {filtered.length ? (
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th className="check">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all players on this page"
                      />
                    </th>
                    <th>Player</th>
                    <th>Role</th>
                    <th>Latest team</th>
                    <th>Flags</th>
                    <th>Status</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className={selected.has(p.id) ? 'selected' : undefined}>
                      <td className="check">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleOne(p.id)}
                          aria-label={`Select ${p.name}`}
                        />
                      </td>
                      <td>
                        <Link to={`/players/${p.id}`} className="strong">
                          {p.name}
                        </Link>
                        <span className="sub">
                          {[p.batting_style ? `${p.batting_style}-hand bat` : null, p.bowl_style ? `${p.bowl_style} bowl` : null]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </span>
                      </td>
                      <td>
                        <RoleBadge role={p.role} />
                      </td>
                      <td>
                        {p.team_name ? (
                          <div className="team-cell">
                            <Crest team={{ short_name: p.team_short, name: p.team_name, color: '#2f6b3f' }} size={20} />
                            <span className="small">{p.team_name}</span>
                          </div>
                        ) : (
                          <span className="small muted">Unassigned</span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {p.is_wicketkeeper ? <span className="badge wk">WK</span> : null}
                          {p.is_captain ? <span className="badge capt">C</span> : null}
                          {!p.is_wicketkeeper && !p.is_captain ? <span className="muted tiny">—</span> : null}
                        </div>
                      </td>
                      <td>
                        {p.is_active ? (
                          <span className="badge completed">Active</span>
                        ) : (
                          <span className="badge">Archived</span>
                        )}
                      </td>
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <Link className="btn btn-sm" to={`/players/${p.id}`}>
                            Profile
                          </Link>
                          <button type="button" className="btn btn-sm" onClick={() => setForm({ player: p })}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => (p.is_active ? removePlayer(p) : restorePlayer(p))}
                          >
                            {p.is_active ? 'Delete' : 'Restore'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No players match">Try a different search, or add a new player.</Empty>
          )}
        </div>
        <div className="panel-foot">
          <span>
            Showing {filtered.length} of {players.length} players
          </span>
        </div>
      </div>

      {form ? (
        <PlayerForm
          player={form.player}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      ) : null}
      {importing ? (
        <ImportDialog
          type="players"
          onClose={() => setImporting(false)}
          onDone={() => {
            load();
          }}
        />
      ) : null}
    </>
  );
}
