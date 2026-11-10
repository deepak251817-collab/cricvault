import { useEffect } from 'react';

export function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="hint">{subtitle}</div> : null}
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

const STATUS_LABELS = {
  draft: 'Draft',
  fixtures: 'Fixtures',
  live: 'Live',
  playoffs: 'Playoffs',
  completed: 'Completed',
  scheduled: 'Scheduled',
  abandoned: 'No result',
};

export function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`badge ${status}`}>
      {status === 'live' ? <i /> : null}
      {label}
    </span>
  );
}

export function RoleBadge({ role }) {
  if (!role) return null;
  const labels = { batter: 'Batter', bowler: 'Bowler', allrounder: 'All-rounder', wicketkeeper: 'Wicketkeeper' };
  return <span className="badge role">{labels[role] || role}</span>;
}

export function Crest({ team, size = 28 }) {
  if (!team) return <span className="crest" style={{ width: size, height: size, background: '#ccc' }}>—</span>;
  const color = team.color || '#2f6b3f';
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const light = (r * 299 + g * 587 + b * 114) / 1000 > 160;
  return (
    <span
      className="crest"
      style={{
        width: size,
        height: size,
        background: color,
        color: light ? '#081b12' : '#fffdf6',
        fontSize: Math.max(9, size * 0.36),
      }}
      title={team.name}
    >
      {(team.short_name || team.name || '?').slice(0, 3)}
    </span>
  );
}

export function Stat({ label, value, suffix, detail }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </div>
      {detail ? <div className="d">{detail}</div> : null}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          className={`tab ${value === tab.key ? 'on' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count != null ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="empty" style={{ padding: 48 }}>
      <span className="display" style={{ letterSpacing: '0.24em', fontSize: 13, color: 'var(--muted)' }}>
        {label.toUpperCase()}…
      </span>
    </div>
  );
}

export function FormRow({ children }) {
  return <div className="row wrap" style={{ gap: 12 }}>{children}</div>;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return 'TBC';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'TBC';
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    . filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// The chip for one delivery: a wicket, a boundary, an extra or a plain number.
export function ballClass(label) {
  if (label === 'W') return 'ball W';
  if (label === '4') return 'ball four';
  if (label === '6') return 'ball six';
  return String(label).length > 1 ? 'ball extra' : 'ball';
}

export function oversFromBalls(balls) {
  return `${Math.floor((balls || 0) / 6)}.${(balls || 0) % 6}`;
}

export function resultBadge(match) {
  if (match.status === 'live') return <StatusBadge status="live" />;
  if (match.status === 'abandoned') return <span className="badge nr">No result</span>;
  if (match.status === 'scheduled') return <StatusBadge status="scheduled" />;
  if (match.result_type === 'tie' || match.result_type === 'draw') return <span className="badge tie">Tied</span>;
  return <span className="badge win">Result</span>;
}
