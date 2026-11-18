import { useState } from 'preact/hooks';
import { NAME_MAX, normalizeName, type JoinResponse, type QuizInfo } from '../../shared/api.ts';
import { api, ApiError } from '../api.ts';
import { POOL_CHOICES } from '../pools.ts';
import { usePwa } from '../pwa.ts';
import { getString, setString } from '../storage.ts';
import { useResults } from '../results.ts';
import { Leaderboard } from './Leaderboard.tsx';
import { ParticipantList } from './WhosIn.tsx';

interface JoinProps {
  info: QuizInfo;
  onJoined: (r: JoinResponse) => void;
}

export function Join({ info, onJoined }: JoinProps) {
  const pwa = usePwa();
  const [name, setName] = useState(() => getString('pq:name') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = normalizeName(name);
  const pool = POOL_CHOICES.find((p) => p.id === info.pool);
  const creator = info.participants.find((p) => p.pid === info.creatorPid);

  const join = async (e: Event) => {
    e.preventDefault();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.join(info.code, clean);
      setString('pq:name', clean);
      onJoined(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the quiz.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="home" onSubmit={join}>
      <section>
        <p class="muted">Pop quiz {info.code}</p>
        <h1>
          {pool?.name ?? info.pool} · {info.mode === 'full' ? 'Full exam' : 'Custom quiz'}
        </h1>
        <p class="lede">
          {info.items.length} questions{creator ? `, started by ${creator.name}` : ''}.
          {info.mode === 'full' && pool ? ` Pass mark ${pool.passing}/${pool.examSize}.` : ''}
        </p>
      </section>

      {info.closed ? (
        <ClosedResults code={info.code} />
      ) : (
        <>
          <fieldset>
            <legend>
              <label for="join-name">Your call sign or nickname</label>
            </legend>
            <input
              id="join-name"
              class="text-input"
              autoComplete="nickname"
              autoCapitalize="characters"
              maxLength={NAME_MAX}
              placeholder="e.g. KC1ABC or Sam"
              value={name}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            />
          </fieldset>
          {error && <p class="error">{error}</p>}
          <button type="submit" class="btn btn-primary btn-big" disabled={!clean || busy || !pwa.online}>
            {busy ? 'Joining…' : pwa.online ? 'Join quiz' : 'Joining needs a connection'}
          </button>
          <p class="tip">
            💡 Finish the quiz in the same app or browser you start it in — your answers are saved there.
          </p>
        </>
      )}

      {!info.closed && (
        <section>
          <h2 class="h-small">Who's in ({info.participants.length})</h2>
          <ParticipantList info={info} />
        </section>
      )}
    </form>
  );
}

/** Someone who never took part opens a closed quiz: leaderboard only (no question breakdown). */
function ClosedResults({ code }: { code: string }) {
  const pwa = usePwa();
  const { data, error } = useResults(code, undefined, pwa.online);
  return (
    <>
      <section class="notice">
        <strong>This quiz is closed.</strong>
        <p>New people can't join anymore. Here's how everyone did.</p>
      </section>
      {data ? <Leaderboard data={data} /> : <p class="muted">{error ? error.message : 'Loading results…'}</p>}
    </>
  );
}
