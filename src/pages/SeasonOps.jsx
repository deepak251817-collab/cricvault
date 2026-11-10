import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Empty, Modal, RoleBadge, StatusBadge, formatDateTime } from '../ui.jsx';
import ImportDialog from '../components/ImportDialog.jsx';

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ------------------------------- fixtures -------------------------------- */

function GenerateFixtures({ season, teams = [], onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ legs: 2 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api(`/seasons/${season.id}/fixtures`, {
        method: 'POST',
        body: { legs: Number(form.legs) },
      });
      toast(`${res.created} fixtures generated — each team meets every other team ${form.legs} time${form.legs === 1 ? '' : 's'}.`);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Generate fixtures"
      subtitle={`${season.name} · every enrolled team faces every other team ${form.legs} time${form.legs === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="gen-fixtures" className="btn btn-primary" disabled={busy}>
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </>
      }
    >
      <form id="gen-fixtures" onSubmit={submit} className="form-grid">
        <div className="field full">
          <label>Times each team meets</label>
          <select className="select" value={form.legs} onChange={(e) => setForm({ ...form, legs: Number(e.target.value) })}>
            {teams.length % 2 === 1
              ? <option value={1}>Once — single round robin (odd number of teams)</option>
              : <option value={1}>Once — single round robin</option>}
            {teams.length % 2 === 1
              ? <option value={2} disabled title="With an odd number of teams, 'twice' cannot be generated in one pass">Twice — home and away</option>
              : <option value={2}>Twice — home and away</option>
            }
            {teams.length % 2 === 1
              ? <option value={3} disabled title="With an odd number of teams, 'twice' cannot be generated in one pass">Three times</option>
              : <option value={3}>Three times</option>
            }
          </select>
          <span className="hint">
            This is all you need. No start date, venue or gap between matches is required — those can be added
            on the fixture list later if you want them.
          </span>
        </div>
        {error ? <div className="error-text full">{error}</div> : null}
      </form>
    </Modal>
  );
}

function AddFixture({ season, teams, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ teamAId: '', teamBId: '', scheduledAt: '', venue: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/seasons/${season.id}/matches`, {
        method: 'POST',
        body: {
          teamAId: Number(form.teamAId),
          teamBId: Number(form.teamBId),
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
          venue: form.venue || null,
        },
      });
      toast('Fixture added');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a fixture"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-fixture" className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add fixture'}
          </button>
        </>
      }
    >
      <form id="add-fixture" onSubmit={submit} className="form-grid">
        <div className="field">
          <label>Team A</label>
          <select className="select" value={form.teamAId} onChange={(e) => setForm({ ...form, teamAId: e.target.value })} required>
            <option value="">Choose team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Team B</label>
          <select className="select" value={form.teamBId} onChange={(e) => setForm({ ...form, teamBId: e.target.value })} required>
            <option value="">Choose team</option>
            {teams
              .filter((t) => String(t.id) !== String(form.teamAId))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label>Date & time</label>
          <input
            className="input"
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Venue</label>
          <input className="input" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </div>
        {error ? <div className="error-text full">{error}</div> : null}
      </form>
    </Modal>
  );
}

function EditFixture({ match, teams, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    teamAId: String(match.team_a_id || ''),
    teamBId: String(match.team_b_id || ''),
    scheduledAt: toLocalInput(match.scheduled_at),
    venue: match.venue || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/matches/${match.id}`, {
        method: 'PATCH',
        body: {
          teamAId: Number(form.teamAId),
          teamBId: Number(form.teamBId),
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
          venue: form.venue || null,
        },
      });
      toast('Fixture updated');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit fixture${match.match_no ? ` #${match.match_no}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-fixture" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save fixture'}
          </button>
        </>
      }
    >
      <form id="edit-fixture" onSubmit={submit} className="form-grid">
        <div className="field">
          <label>Team A</label>
          <select className="select" value={form.teamAId} onChange={(e) => setForm({ ...form, teamAId: e.target.value })} required>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Team B</label>
          <select className="select" value={form.teamBId} onChange={(e) => setForm({ ...form, teamBId: e.target.value })} required>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Date & time</label>
          <input
            className="input"
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Venue</label>
          <input className="input" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </div>
        {error ? <div className="error-text full">{error}</div> : null}
      </form>
    </Modal>
  );
}

export function FixturesTab({ season, matches, teams, canEdit, onChanged }) {
  const toast = useToast();
  const [gen, setGen] = useState(false);
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const league = matches.filter((m) => m.stage === 'league');
  const playoffs = matches.filter((m) => m.stage === 'playoff');

  const remove = async (match) => {
    if (!window.confirm('Delete this scheduled fixture?')) return;
    try {
      await api(`/matches/${match.id}`, { method: 'DELETE' });
      toast('Fixture deleted');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>League fixtures</h3>
          <span className="sub">{league.length} matches</span>
          {canEdit ? (
            <div className="right row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => setAdd(true)}>
                + Add fixture
              </button>
              <button
                type="button"
                className="btn btn-sm btn-dark"
                onClick={() => (teams.length ? setGen(true) : toast('Add teams to this season first', 'error'))}
              >
                Generate fixtures
              </button>
            </div>
          ) : null}
        </div>
        <div className="panel-body flush">
          {league.length ? (
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Fixture</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {league.map((m) => (
                    <tr key={m.id}>
                      <td className="num muted" style={{ width: 50 }}>
                        {m.match_no || '—'}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Crest team={{ short_name: m.team_a_short, name: m.team_a_name, color: m.team_a_color }} size={22} />
                          <Link to={`/matches/${m.id}`} className="strong">
                            {m.team_a_short || 'TBD'} <span className="muted" style={{ fontWeight: 400 }}>v</span>{' '}
                            {m.team_b_short || 'TBD'}
                          </Link>
                        </div>
                        <span className="sub">{m.venue ? m.venue : m.result_text || 'Venue TBC'}</span>
                      </td>
                      <td className="small muted" style={{ width: 150 }}>
                        {formatDateTime(m.scheduled_at)}
                      </td>
                      <td style={{ width: 110 }}>
                        {m.status === 'completed' ? <span className="badge win">Result</span> : <StatusBadge status={m.status} />}
                      </td>
                      <td className="right" style={{ width: 220 }}>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          {m.status === 'scheduled' && canEdit ? (
                            <>
                              <button type="button" className="btn btn-sm" onClick={() => setEditing(m)}>
                                Edit
                              </button>
                              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(m)}>
                                Delete
                              </button>
                            </>
                          ) : null}
                          {m.status === 'completed' || m.status === 'abandoned' ? (
                            <Link className="btn btn-sm" to={`/matches/${m.id}/scorecard`}>
                              Scorecard
                            </Link>
                          ) : (
                            <Link className="btn btn-sm btn-primary" to={`/matches/${m.id}`}>
                              {m.status === 'live' ? 'Score' : 'Set up'}
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No fixtures yet">
              {canEdit
                ? 'Generate a round robin in one click, or add matches one at a time.'
                : 'The administrator has not published fixtures.'}
            </Empty>
          )}
        </div>
      </div>

      {playoffs.length ? (
        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h3>Playoffs</h3>
            <span className="sub">{playoffs.length} matches</span>
          </div>
          <div className="panel-body flush">
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Fixture</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {playoffs.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span className="display" style={{ fontSize: 13, letterSpacing: '0.08em' }}>
                          {m.stage_name}
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="strong">{m.team_a_short || 'TBD'}</span>
                          <span className="muted">v</span>
                          <span className="strong">{m.team_b_short || 'TBD'}</span>
                        </div>
                        <span className="sub">{m.result_text || ''}</span>
                      </td>
                      <td className="small muted">{formatDateTime(m.scheduled_at)}</td>
                      <td>{m.status === 'completed' ? <span className="badge win">Result</span> : <StatusBadge status={m.status} />}</td>
                      <td className="right">
                        <Link className="btn btn-sm" to={`/matches/${m.id}`}>
                          {m.status === 'completed' ? 'View' : 'Open'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {gen && teams.length ? (
        <GenerateFixtures
          season={season}
          teams={teams}
          onClose={() => setGen(false)}
          onSaved={() => {
            setGen(false);
            onChanged();
          }}
        />
      ) : null}
      {add ? (
        <AddFixture
          season={season}
          teams={teams}
          onClose={() => setAdd(false)}
          onSaved={() => {
            setAdd(false);
            onChanged();
          }}
        />
      ) : null}
      {editing ? (
        <EditFixture
          match={editing}
          teams={teams}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/* --------------------------------- squads -------------------------------- */

export function SquadsTab({ season, teams, squads, canEdit, onChanged }) {
  const { user } = useApp();
  const toast = useToast();
  const [teamId, setTeamId] = useState(teams[0]?.id || null);
  const [pool, setPool] = useState([]);
  const [pickedIds, setPickedIds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ name: '', role: 'batter' });
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const canAdd = !!canEdit;
  const canManageTeam = canAdd || (user?.role === 'team' && Number(user.team_id) === Number(teamId));
  const squad = squads[String(teamId)] || [];
  const team = teams.find((t) => t.id === Number(teamId));

  const captains = squad.filter((p) => p.is_captain);
  const keepers = squad.filter((p) => p.is_wicketkeeper);
  const captainOk = captains.length <= 1;
  const wkOk = keepers.length >= 1;

  const loadPool = () =>
    api('/players?all=1')
      .then(setPool)
      .catch(() => {});

  useEffect(() => {
    loadPool();
  }, []);

  useEffect(() => {
    setPickedIds([]);
  }, [teamId]);

  useEffect(() => {
    if (!teams.length) return;
    if (!teams.some((t) => t.id === Number(teamId))) {
      const mine = user?.role === 'team' ? teams.find((t) => t.id === Number(user.team_id)) : null;
      setTeamId((mine || teams[0]).id);
    }
  }, [teams, teamId, user]);

  const patchFlag = (player, body) =>
    api(`/seasons/${season.id}/squad/${player.player_id}`, { method: 'PATCH', body });

  const setCaptain = async (player) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!player.is_captain) {
        for (const prev of captains) {
          if (prev.player_id === player.player_id) continue;
          await patchFlag(prev, { isCaptain: false });
        }
      }
      await patchFlag(player, { isCaptain: !player.is_captain });
      onChanged();
      toast(player.is_captain ? `${player.name} is no longer captain` : `${player.name} is captain`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Only a batter may take the gloves; the server rejects the rest too.
  const canKeep = (player) => player.role === 'batter' || player.role === 'wicketkeeper';

  const setKeeper = async (player) => {
    if (busy) return;
    if (!player.is_wicketkeeper && !canKeep(player)) {
      toast('Only a batter can keep wicket — bowlers and all-rounders cannot', 'error');
      return;
    }
    setBusy(true);
    try {
      await patchFlag(player, { isWicketkeeper: !player.is_wicketkeeper });
      onChanged();
      toast(
        player.is_wicketkeeper
          ? `${player.name} is no longer a wicketkeeper`
          : `${player.name} is a wicketkeeper`
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const inSeason = new Set(Object.values(squads).flat().map((p) => p.player_id));
  const available = pool.filter((p) => !inSeason.has(p.id));

  const addPlayer = async (body) => {
    setBusy(true);
    try {
      await api(`/seasons/${season.id}/squad`, { method: 'POST', body: { teamId, ...body } });
      toast('Player added to squad');
      setNewPlayer({ name: '', role: 'batter' });
      setCreating(false);
      await loadPool();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const spotsLeft = Math.max(12 - squad.length, 0);

  const togglePick = (playerId) => {
    setPickedIds((prev) => {
      if (prev.includes(playerId)) return prev.filter((id) => id !== playerId);
      if (prev.length >= spotsLeft) return prev;
      return [...prev, playerId];
    });
  };

  const addPicked = async () => {
    if (!pickedIds.length) return;
    setBusy(true);
    try {
      const res = await api(`/seasons/${season.id}/squad/bulk`, {
        method: 'POST',
        body: { teamId, playerIds: pickedIds },
      });
      const skipped = res.skipped || [];
      toast(
        `${res.added.length} player${res.added.length === 1 ? '' : 's'} added` +
          (skipped.length ? ` · ${skipped.length} skipped: ${skipped[0].name} — ${skipped[0].reason}` : ''),
        skipped.length ? 'error' : undefined
      );
      setPickedIds([]);
      await loadPool();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportSquad = async () => {
    const team = teams.find((t) => Number(t.id) === Number(teamId));
    const name = String(team?.name || 'squad')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    try {
      await downloadFile(`/seasons/${season.id}/squad/${teamId}/export`, `cricvault-${name}-squad-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const remove = async (player) => {
    if (
      !window.confirm(
        `Remove ${player.name} from this team? They will leave the squad and can be assigned to another team.`
      )
    )
      return;
    try {
      await api(`/seasons/${season.id}/squad/${player.player_id}`, { method: 'DELETE' });
      toast('Player removed from the team');
      await loadPool();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!teams.length) {
    return (
      <div className="panel">
        <Empty title="No teams in this season">Add teams to the season first.</Empty>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>Squad</h3>
          <select className="select" style={{ width: 190 }} value={teamId || ''} onChange={(e) => setTeamId(Number(e.target.value))}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="sub">
            {squad.length}/12 players{squad.length && !wkOk ? ' · needs a wicketkeeper' : ''}
          </span>
          <div className="right row" style={{ gap: 8, alignItems: 'center' }}>
            {squad.length ? (
              <>
                <span
                  className={`badge capt ${captainOk && captains.length === 1 ? 'on' : 'off'}`}
                  title="A team can only have one captain"
                >
                  C {captains.length}/1
                </span>
                <span className={`badge wk ${wkOk ? 'on' : 'off'}`} title="A team can have more than one wicketkeeper">
                  WK {keepers.length}
                </span>
              </>
            ) : null}
            {squad.length ? (
              <button type="button" className="btn btn-sm" onClick={exportSquad}>
                Export
              </button>
            ) : null}
            {canAdd ? (
              <button type="button" className="btn btn-sm" onClick={() => setImporting(true)}>
                Import players
              </button>
            ) : null}
          </div>
        </div>

        <div className="panel-body flush">
          {squad.length ? (
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Role</th>
                    <th>Style</th>
                    <th>Flags</th>
                    {canManageTeam ? <th className="right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {squad.map((p) => (
                    <tr key={p.player_id} className={`squad-row${p.is_captain ? ' captain' : ''}`}>
                      <td>
                        <Link to={`/players/${p.player_id}`} className="strong">
                          {p.name}
                        </Link>
                      </td>
                      <td>
                        <RoleBadge role={p.role} />
                      </td>
                      <td className="small muted">{[p.batting_style, p.bowl_style].filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {p.is_captain ? (
                            <span className="badge capt on" title="Captain">
                              C
                            </span>
                          ) : null}
                          {p.is_wicketkeeper ? (
                            <span className="badge wk" title="Wicketkeeper">
                              WK
                            </span>
                          ) : null}
                          {!p.is_captain && !p.is_wicketkeeper ? <span className="muted tiny">—</span> : null}
                        </div>
                      </td>
                      {canManageTeam ? (
                        <td className="right">
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 5 }}>
                            <button
                              type="button"
                              className={`btn btn-sm cap-toggle${p.is_captain ? ' on' : ''}`}
                              title={p.is_captain ? 'Remove captaincy' : 'Make captain (only one per team)'}
                              onClick={() => setCaptain(p)}
                              disabled={busy}
                            >
                              C
                            </button>
                            <button
                              type="button"
                              className={`btn btn-sm wk-toggle${p.is_wicketkeeper ? ' on' : ''}`}
                              title={
                                p.is_wicketkeeper
                                  ? 'Remove wicketkeeper flag'
                                  : canKeep(p)
                                    ? 'Flag as wicketkeeper'
                                    : 'Only a batter can keep wicket'
                              }
                              onClick={() => setKeeper(p)}
                              disabled={busy || (!p.is_wicketkeeper && !canKeep(p))}
                            >
                              WK
                            </button>
                            {canAdd ? (
                              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(p)}>
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={`${team?.name || 'This team'} has no squad`}>
              {canAdd
                ? 'Pick players from the pool, create a new player, or import a spreadsheet.'
                : canManageTeam
                  ? 'No players are in this squad yet.'
                  : 'The squad is not announced yet.'}
            </Empty>
          )}
        </div>

        {squad.length ? (
          <div className="panel-foot">
            <span className={captainOk && captains.length === 1 ? 'small muted' : 'small error-text'}>
              {captains.length === 0
                ? 'No captain picked yet — tap C next to a player to appoint one.'
                : captains.length > 1
                  ? 'Only one captain per team — remove the extra captain.'
                  : `Captain: ${captains[0].name}`}
            </span>
            <span className={wkOk ? 'small muted' : 'small error-text'}>
              {wkOk
                ? `Wicketkeepers: ${keepers.map((k) => k.name).join(', ')}`
                : 'Flag at least one wicketkeeper with WK.'}
            </span>
          </div>
        ) : null}
      </div>

      {canAdd ? (
        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h3>Add to {team?.name}</h3>
            <span className="right tiny muted">{12 - squad.length} spots left</span>
          </div>
          <div className="panel-body">
            <div className="row wrap" style={{ alignItems: 'center', gap: 10 }}>
              <span className="small muted">
                {available.length
                  ? 'Tap players to pick them — only players without a team this season are listed.'
                  : 'Every player is already in a squad this season.'}
              </span>
              {available.length && spotsLeft ? (
                <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setPickedIds(available.slice(0, spotsLeft).map((p) => p.id))}
                  >
                    {spotsLeft < available.length ? `Pick first ${spotsLeft}` : 'Pick all'}
                  </button>
                  {pickedIds.length ? (
                    <button type="button" className="btn btn-sm" onClick={() => setPickedIds([])}>
                      Clear
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {available.length ? (
              <div className="pick-list">
                {available.map((p) => {
                  const on = pickedIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`pick-chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      disabled={!on && (!spotsLeft || pickedIds.length >= spotsLeft)}
                      onClick={() => togglePick(p.id)}
                    >
                      {p.name}
                      <span className="role">
                        {{ batter: 'BAT', bowler: 'BOWL', allrounder: 'AR', wicketkeeper: 'WK' }[p.role] || p.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="row wrap" style={{ alignItems: 'center', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pickedIds.length || busy}
                onClick={addPicked}
              >
                {busy
                  ? 'Adding…'
                  : pickedIds.length
                    ? `Add ${pickedIds.length} player${pickedIds.length === 1 ? '' : 's'}`
                    : 'Add players'}
              </button>
              <button type="button" className="btn" onClick={() => setCreating((v) => !v)} disabled={squad.length >= 12}>
                {creating ? 'Cancel new player' : 'Create new player'}
              </button>
              <span className="tiny muted">
                {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left · tap a picked player again to drop them.
              </span>
            </div>

            {creating ? (
              <div
                className="row wrap"
                style={{ alignItems: 'flex-end', gap: 10, marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}
              >
                <div className="field grow" style={{ minWidth: 220 }}>
                  <label>Player name</label>
                  <input
                    className="input"
                    value={newPlayer.name}
                    onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
                    placeholder="Full name"
                  />
                </div>
                <div className="field" style={{ width: 170 }}>
                  <label>Role</label>
                  <select
                    className="select"
                    value={newPlayer.role}
                    onChange={(e) => setNewPlayer({ ...newPlayer, role: e.target.value })}
                  >
                    <option value="batter">Batter</option>
                    <option value="bowler">Bowler</option>
                    <option value="allrounder">All-rounder</option>
                    <option value="wicketkeeper">Wicketkeeper</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-dark"
                  disabled={!newPlayer.name.trim() || busy}
                  onClick={() =>
                    addPlayer({
                      playerName: newPlayer.name.trim(),
                      role: newPlayer.role,
                      isWicketkeeper: newPlayer.role === 'wicketkeeper',
                    })
                  }
                >
                  Create &amp; add
                </button>
              </div>
            ) : null}

          </div>
        </div>
      ) : null}

      {importing ? (
        <ImportDialog
          type="players"
          seasonId={season.id}
          onClose={() => setImporting(false)}
          onDone={async () => {
            await loadPool();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------- playoffs ------------------------------- */

export function PlayoffsTab({ data, canEdit, onChanged }) {
  const { season, points } = data;
  const toast = useToast();
  const bracket = data.matches.filter((m) => m.stage === 'playoff');
  const [size, setSize] = useState(season.playoff_teams || 4);
  const [order, setOrder] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrder(points.slice(0, size).map((r) => r.teamId));
  }, [size, points, season.id]);

  const move = (index, delta) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  const create = async () => {
    setBusy(true);
    try {
      await api(`/seasons/${season.id}/playoffs`, { method: 'POST', body: { teamIds: order } });
      toast('Playoff bracket created');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Remove the playoff bracket? Only allowed before any playoff match is played.')) return;
    try {
      await api(`/seasons/${season.id}/playoffs`, { method: 'DELETE' });
      toast('Playoff bracket removed');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!bracket.length) {
    if (!canEdit) {
      return (
        <div className="panel">
          <Empty title="Playoffs not set">The administrator has not configured the playoff bracket yet.</Empty>
        </div>
      );
    }
    if (points.length < 2) {
      return (
        <div className="panel">
          <Empty title="Not enough teams">Play at least one league match so a table exists.</Empty>
        </div>
      );
    }
    return (
      <div className="panel">
        <div className="panel-head">
          <h3>Configure playoffs</h3>
          <span className="sub">Pick the bracket size, then fine-tune the seeding order</span>
          <div className="right seg">
            {[2, 4, 5].map((n) => (
              <button key={n} type="button" className={size === n ? 'on' : ''} onClick={() => setSize(n)} disabled={points.length < n}>
                Top {n}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          <div className="stack">
            {order.map((teamId, index) => {
              const row = points.find((p) => p.teamId === teamId);
              if (!row) return null;
              return (
                <div key={teamId} className="row" style={{ gap: 10, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                  <span className="pos" style={{ width: 24 }}>
                    {index + 1}
                  </span>
                  <Crest team={{ short_name: row.shortName, name: row.name, color: row.color }} size={24} />
                  <span className="strong grow">{row.name}</span>
                  <span className="tiny muted">
                    {row.points} pts · NRR {row.nrr > 0 ? '+' : ''}
                    {row.nrr.toFixed(3)}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => move(index, -1)} disabled={index === 0}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => move(index, 1)} disabled={index === order.length - 1}>
                    ↓
                  </button>
                </div>
              );
            })}
          </div>
          <div className="hint" style={{ marginTop: 12 }}>
            {size === 2 && 'Top 2 meet in a straight final.'}
            {size === 4 && 'Qualifier 1 (1 v 2), Eliminator (3 v 4), Qualifier 2 (loser Q1 v winner Eliminator), Final.'}
            {size === 5 && 'Eliminator 1 (4 v 5) → Eliminator 2 (3 v winner), Qualifier 1 (1 v 2), Qualifier 2, Final.'}
          </div>
        </div>
        <div className="panel-foot">
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || order.length !== size}>
            {busy ? 'Creating…' : 'Create playoff bracket'}
          </button>
          <span>Teams advance automatically as results come in.</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {data.winner ? (
        <div className="hero-live" style={{ marginBottom: 18 }}>
          <div className="inner">
            <div className="sb-top">
              <span>Champions</span>
              <span>·</span>
              <span>{season.name}</span>
            </div>
            <div className="row" style={{ gap: 14 }}>
              <Crest team={data.winner} size={44} />
              <div>
                <div className="sb-score" style={{ fontSize: 38 }}>
                  {data.winner.name}
                </div>
                <div className="sb-meta">
                  <span>
                    Runners-up <b>{data.runnerUp?.name || '—'}</b>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h3>Bracket</h3>
          <span className="sub">{season.playoff_teams ? `Top ${season.playoff_teams}` : ''}</span>
          {canEdit ? (
            <button type="button" className="right btn btn-sm btn-ghost" onClick={reset}>
              Reset bracket
            </button>
          ) : null}
        </div>
        <div className="panel-body">
          <div className="bracket">
            {bracket.map((m, i) => (
              <div key={m.id} className={`playoff-card ${i === bracket.length - 1 ? 'final' : ''}`}>
                <div className="stage">{m.stage_name}</div>
                <div className="side">
                  <span className="seed">{m.seed_a?.replace('W:', 'W').replace('L:', 'L')}</span>
                  {m.team_a_name ? (
                    <>
                      <Crest team={{ short_name: m.team_a_short, name: m.team_a_name, color: m.team_a_color }} size={18} />
                      <span className={m.winner_team_id === m.team_a_id ? 'strong' : ''}>{m.team_a_name}</span>
                    </>
                  ) : (
                    <span className="tbd">TBD</span>
                  )}
                </div>
                <div className="side">
                  <span className="seed">{m.seed_b?.replace('W:', 'W').replace('L:', 'L')}</span>
                  {m.team_b_name ? (
                    <>
                      <Crest team={{ short_name: m.team_b_short, name: m.team_b_name, color: m.team_b_color }} size={18} />
                      <span className={m.winner_team_id === m.team_b_id ? 'strong' : ''}>{m.team_b_name}</span>
                    </>
                  ) : (
                    <span className="tbd">TBD</span>
                  )}
                </div>
                {m.result_text ? <div className="res">{m.result_text}</div> : null}
                <div style={{ marginTop: 8 }}>
                  <Link className="btn btn-sm" to={`/matches/${m.id}`}>
                    {m.status === 'completed' ? 'View match' : 'Open'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
