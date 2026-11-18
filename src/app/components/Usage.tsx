import { useEffect, useState } from 'preact/hooks';
import type { UsageResponse } from '../../shared/api.ts';
import { api, ApiError } from '../api.ts';
import { POOL_CHOICES } from '../pools.ts';
import { deviceId } from '../usage.ts';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const pct = (x: number) => `${Math.round(x * 100)}%`;

async function myShortId(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceId()));
  return Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function Usage({ online }: { online: boolean }) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .usage()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load usage'));
  };
  useEffect(() => {
    load();
    void myShortId().then(setMine).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (online && error) load();
  }, [online]);

  if (error)
    return (
      <div class="home">
        <h1>Usage</h1>
        <p class="error">{error}</p>
      </div>
    );
  if (!data) return <p class="muted center">Loading usage…</p>;

  const { devices: d, quizzes: q } = data;
  const maxOpens = Math.max(1, ...data.daily.map((x) => x.opens));
  const poolName = (id: string) => POOL_CHOICES.find((p) => p.id === id)?.name ?? id;

  return (
    <div class="home usage">
      <h1>Usage</h1>
      <p class="lede">
        Anonymous counts for the last {data.days} days. Each device gets a random id; nothing here identifies a person.
      </p>

      <section>
        <h2>Devices</h2>
        <div class="stat-grid">
          <Stat label="Last 30 days" value={d.last30d} />
          <Stat label="Last 7 days" value={d.last7d} />
          <Stat label="Last 24 hours" value={d.last24h} />
          <Stat label="New (30 days)" value={d.new30d} />
          <Stat label="Came back on 2+ days" value={d.returning30d} />
          <Stat label="Sessions (30 days)" value={data.opens30d} />
        </div>
        <p class="muted small">
          {d.total} {d.total === 1 ? 'device' : 'devices'} seen in all. A session is opening the app after 30 minutes
          away.
        </p>
      </section>

      <section>
        <h2>Quizzes</h2>
        <div class="stat-grid">
          <Stat label="Created" value={q.created30d} />
          <Stat label="Still open" value={q.open} />
          <Stat label="People joined" value={q.participants} />
          <Stat label="Finished" value={q.finished} />
          <Stat label="People per quiz" value={q.avgPerQuiz.toFixed(1)} />
          <Stat label="Full-exam pass rate" value={q.passRate === null ? '—' : pct(q.passRate)} />
          <Stat label="Answers recorded" value={q.answers} />
          <Stat label="Full / custom" value={`${q.full} / ${q.custom}`} />
        </div>
        {q.byPool.length > 0 && (
          <p class="muted small">
            By exam: {q.byPool.map((p) => `${poolName(p.pool)} ${p.count}`).join(' · ')}
          </p>
        )}
      </section>

      <section>
        <h2>Sessions per day</h2>
        <div class="usage-chart" role="img" aria-label="Sessions per day over the last 30 days">
          {data.daily.map((x) => (
            <div
              class="usage-bar"
              style={{ height: `${(x.opens / maxOpens) * 100}%` }}
              title={`${x.day}: ${x.opens} sessions, ${x.devices} devices`}
            />
          ))}
        </div>
        <div class="usage-axis muted small">
          <span>{data.daily[0]?.day.slice(5)}</span>
          <span>{data.daily.at(-1)?.day.slice(5)}</span>
        </div>
      </section>

      <section>
        <h2>Each device, last 30 days</h2>
        {data.perDevice.length === 0 ? (
          <p class="muted">No activity yet.</p>
        ) : (
          <div class="table-wrap">
            <table class="usage-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th class="num">Sessions</th>
                  <th class="num">Days</th>
                  <th class="num">Created</th>
                  <th class="num">Joined</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.perDevice.map((r) => (
                  <tr class={r.id === mine ? 'me' : undefined}>
                    <td>
                      <code>{r.id}</code>
                      {r.id === mine && <small> (you)</small>}
                    </td>
                    <td class="num">{r.opens}</td>
                    <td class="num">{r.activeDays}</td>
                    <td class="num">{r.created}</td>
                    <td class="num">{r.joined}</td>
                    <td title={`First seen ${fmtDate(r.firstSeen)}`}>{fmtDate(r.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div class="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
