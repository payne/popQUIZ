import { useEffect } from 'preact/hooks';
import type { QuizInfo } from '../../shared/api.ts';
import { Modal } from './Modal.tsx';

export function ParticipantList({ info, myPid }: { info: QuizInfo; myPid?: string }) {
  return (
    <ul class="people">
      {info.participants.map((p) => (
        <li>
          <span class="person-name">
            {p.name}
            {p.pid === myPid && <span class="muted"> (you)</span>}
            {p.pid === info.creatorPid && <span class="tag">started it</span>}
          </span>
          <span class={`person-status${p.finished ? ' done' : ''}`}>{p.finished ? 'Finished' : 'Working…'}</span>
        </li>
      ))}
    </ul>
  );
}

interface WhosInProps {
  info: QuizInfo | null;
  myPid: string;
  onRefresh: () => void;
  onClose: () => void;
}

/** "Who's in" dialog; refreshes every 15 s while open. */
export function WhosIn({ info, myPid, onRefresh, onClose }: WhosInProps) {
  useEffect(() => {
    onRefresh();
    const t = setInterval(onRefresh, 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Modal
      title={info ? `Who's in (${info.participants.length})` : "Who's in"}
      onClose={onClose}
      actions={
        <button type="button" class="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {info ? <ParticipantList info={info} myPid={myPid} /> : <p class="muted">Loading… (needs a connection)</p>}
      {info?.closed && <p class="muted">This quiz is closed.</p>}
    </Modal>
  );
}
