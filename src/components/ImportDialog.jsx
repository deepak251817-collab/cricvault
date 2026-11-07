import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Modal } from '../ui.jsx';

export default function ImportDialog({ type = 'players', seasonId: initialSeason = '', onClose, onDone }) {
  const { seasons } = useApp();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [seasonId, setSeasonId] = useState(initialSeason ? String(initialSeason) : '');
  const [teamId, setTeamId] = useState('');
  const [seasonTeams, setSeasonTeams] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const noun = type === 'teams' ? 'teams' : 'players';

  useEffect(() => {
    if (type !== 'players' || !seasonId) {
      setSeasonTeams([]);
      setTeamId('');
      return;
    }
    let active = true;
    api(`/seasons/${seasonId}`)
      .then((data) => {
        if (!active) return;
        setSeasonTeams((data.teams || []).slice().sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (active) setSeasonTeams([]);
      });
    return () => {
      active = false;
    };
  }, [type, seasonId]);

  const template = async () => {
    try {
      await downloadFile(`/import/templates/${type}`, `cricvault-${type}-template.xlsx`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const run = async (dryRun) => {
    if (!file) {
      setError('Choose a spreadsheet first');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (seasonId) fd.append('seasonId', seasonId);
      if (type === 'players' && teamId) fd.append('teamId', teamId);
      if (type === 'teams' && seasonId) fd.append('addToSeason', '1');
      if (dryRun) fd.append('dryRun', '1');
      const data = await api(`/import/${type}`, { method: 'POST', body: fd });
      setResult(data);
      if (!dryRun) {
        toast(`${data.created} created · ${data.updated} updated`);
        onDone?.(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Import ${noun}`}
      subtitle="Excel or CSV. Download the template, fill one row per record, then upload."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn" onClick={() => run(true)} disabled={busy || !file}>
            Preview
          </button>
          <button type="button" className="btn btn-primary" onClick={() => run(false)} disabled={busy || !file}>
            {busy ? 'Working…' : `Import ${noun}`}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="row wrap">
          <button type="button" className="btn btn-sm" onClick={template}>
            ↓ Download {noun} template
          </button>
          <span className="hint">
            {type === 'players'
              ? 'Columns: Player Name, Role, Batting, Bowling, Wicketkeeper, Captain'
              : 'Columns: Team Name, Short Name'}
          </span>
        </div>

        <label className="dropzone" style={{ display: 'block' }}>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setResult(null);
              setError('');
            }}
          />
          <b>{file ? file.name : 'Choose a spreadsheet'}</b>
          {file ? `${(file.size / 1024).toFixed(1)} KB · click to replace` : 'XLSX, XLS or CSV · up to 8 MB'}
        </label>

        <div className="field">
          <label>{type === 'teams' ? 'Also enrol imported teams in a season' : 'Place players into squads for'}</label>
          <select
            className="select"
            value={seasonId}
            onChange={(e) => {
              setSeasonId(e.target.value);
              setTeamId('');
              setResult(null);
            }}
          >
            <option value="">{type === 'teams' ? 'Do not add to a season' : 'No season — add to player pool only'}</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {type === 'players' && seasonId ? (
          <div className="field">
            <label>Assign imported players to team</label>
            <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Player pool only — assign to teams later</option>
              {seasonTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.short_name})
                </option>
              ))}
            </select>
            <span className="hint">
              The team and season are chosen here (not in the spreadsheet). Squads are capped at 12 players.
            </span>
          </div>
        ) : (
          <span className="hint">
            {type === 'players'
              ? 'Choose a season and team above to place every imported player into that squad. Leave the team on player pool only to assign later.'
              : 'Teams are created once and can belong to any number of seasons.'}
          </span>
        )}

        {error ? <div className="error-text">{error}</div> : null}

        {result ? (
          <div className="import-result">
            <div className="row wrap" style={{ gap: 16 }}>
              <span>
                <b>{result.created}</b> created
              </span>
              <span>
                <b>{result.updated}</b> updated
              </span>
              {type === 'players' ? (
                <span>
                  <b>{result.squadAdded}</b> added to squads
                </span>
              ) : null}
              <span>
                <b>{result.errors.length}</b> row error{result.errors.length === 1 ? '' : 's'}
              </span>
              {result.dryRun ? <span className="badge">Preview only</span> : null}
            </div>
            {result.errors.length ? (
              <ul>
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="hint" style={{ marginTop: 6 }}>
                Every row validated cleanly.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
