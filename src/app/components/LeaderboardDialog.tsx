import { usePwa } from '../pwa.ts';
import { useResults } from '../results.ts';
import { Leaderboard } from './Leaderboard.tsx';
import { Modal } from './Modal.tsx';

export function LeaderboardDialog({ code, token, myPid, onClose }: { code: string; token: string; myPid: string; onClose: () => void }) {
  const pwa = usePwa();
  const { data, error } = useResults(code, token, pwa.online);
  return (
    <Modal
      title="Leaderboard"
      onClose={onClose}
      actions={
        <button type="button" class="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {data ? (
        <Leaderboard data={data} myPid={myPid} />
      ) : (
        <p class="muted">{!pwa.online ? 'Needs a connection.' : error ? error.message : 'Loading…'}</p>
      )}
    </Modal>
  );
}
