import { useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { shareUrl } from '../router.ts';
import { Modal } from './Modal.tsx';

interface ShareProps {
  code: string;
  poolName: string;
  /** Open straight to the big QR code (club-meeting mode). */
  qrFirst?: boolean;
  onClose: () => void;
}

export function Share({ code, poolName, qrFirst, onClose }: ShareProps) {
  const url = shareUrl(code);
  const text = `Join my ${poolName} pop quiz: ${url}`;
  const [copied, setCopied] = useState(false);
  const qr = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(url, { border: 2, ecc: 'M' }))}`,
    [url],
  );
  const canShare = typeof navigator.share === 'function';

  const share = async () => {
    try {
      await navigator.share({ title: 'Pop Quiz', text: `Join my ${poolName} pop quiz`, url });
    } catch {
      /* cancelled */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is visible and selectable */
    }
  };

  return (
    <Modal
      title="Share this quiz"
      onClose={onClose}
      actions={
        <button type="button" class="btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div class={`share${qrFirst ? ' qr-first' : ''}`}>
        <p class="share-code" aria-label={`Quiz code ${code.split('').join(' ')}`}>
          {code}
        </p>
        <input class="text-input share-url" readOnly value={url} onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} aria-label="Quiz link" />
        <div class="share-buttons">
          {canShare && (
            <button type="button" class="btn btn-primary" onClick={share}>
              Share…
            </button>
          )}
          <button type="button" class={canShare ? 'btn' : 'btn btn-primary'} onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <a class="btn" href={`sms:?&body=${encodeURIComponent(text)}`}>
            Text it
          </a>
        </div>
        <figure class="qr">
          <img src={qr} alt={`QR code for ${url}`} width="240" height="240" />
          <figcaption class="muted small">Scan to join</figcaption>
        </figure>
      </div>
    </Modal>
  );
}
