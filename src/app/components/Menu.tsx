import { useEffect, useState } from 'preact/hooks';
import { getString, setString } from '../storage.ts';
import { isIOS, promptInstall, reloadApp, resetEverything, usePwa } from '../pwa.ts';
import { Confirm, Modal } from './Modal.tsx';

type Theme = 'system' | 'light' | 'dark';

function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  setString('pq:theme', t === 'system' ? null : t);
}

interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** Present when there is something to start over from. */
  onNewQuiz?: () => void;
  quizInProgress: boolean;
}

export function Menu({ open, onClose, onNewQuiz, quizInProgress }: MenuProps) {
  const pwa = usePwa();
  const [theme, setTheme] = useState<Theme>(() => (getString('pq:theme') as Theme | null) ?? 'system');
  const [dialog, setDialog] = useState<null | 'reload' | 'reset' | 'new' | 'ios'>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !dialog && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, dialog]);

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };

  const showInstall = !pwa.installed && (pwa.canInstall || isIOS);

  return (
    <>
      <div class={`menu-backdrop${open ? ' open' : ''}`} onClick={onClose} aria-hidden="true" />
      <nav class={`menu${open ? ' open' : ''}`} aria-label="Menu" aria-hidden={!open} inert={!open}>
        <div class="menu-head">
          <strong>Pop Quiz</strong>
          <button type="button" class="icon-btn" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </div>

        <ul class="menu-list">
          {onNewQuiz && (
            <li>
              <button type="button" onClick={() => (quizInProgress ? setDialog('new') : (onNewQuiz(), onClose()))}>
                ＋ New quiz
              </button>
            </li>
          )}
          {/* Share, QR code, Who's in, and Results arrive with shared quizzes (step 3). */}
          {showInstall && (
            <li>
              <button
                type="button"
                onClick={() => (pwa.canInstall ? promptInstall().then(onClose) : setDialog('ios'))}
              >
                ⤓ Install app
              </button>
            </li>
          )}
          <li class="menu-theme">
            <span>Theme</span>
            <div class="segmented" role="radiogroup" aria-label="Theme">
              {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                <button type="button" role="radio" aria-checked={theme === t} onClick={() => chooseTheme(t)}>
                  {t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </li>
        </ul>

        <ul class="menu-list menu-bottom">
          <li>
            <button type="button" disabled={!pwa.online} onClick={() => setDialog('reload')}>
              ⟳ Reload app
              <small>{pwa.online ? 'Fetch the latest version · keeps your progress' : 'Needs a connection'}</small>
            </button>
          </li>
          <li>
            <button type="button" class="danger" disabled={!pwa.online} onClick={() => setDialog('reset')}>
              ⚠ Reset everything
              <small>{pwa.online ? 'Erases all progress on this device' : 'Needs a connection'}</small>
            </button>
          </li>
        </ul>
        <p class="menu-version">
          v{__APP_VERSION__} · {__BUILD_DATE__}
        </p>
      </nav>

      {dialog === 'reload' && (
        <Confirm
          title="Reload app?"
          confirmLabel="Reload"
          onCancel={() => setDialog(null)}
          onConfirm={() => void reloadApp()}
        >
          <p>This clears the app's saved files and downloads the latest version.</p>
          <p>Your quiz progress stays on this device.</p>
        </Confirm>
      )}
      {dialog === 'reset' && (
        <Confirm
          title="Reset everything?"
          confirmLabel="Erase and reset"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => void resetEverything()}
        >
          <p>
            <strong>This erases all quiz progress saved on this device</strong>, including any quiz you haven't
            finished, and reloads the app as if it were your first visit.
          </p>
          <p>This can't be undone.</p>
        </Confirm>
      )}
      {dialog === 'new' && onNewQuiz && (
        <Confirm
          title="Start a new quiz?"
          confirmLabel="Start over"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            onNewQuiz();
            onClose();
          }}
        >
          <p>Your current quiz isn't submitted yet. Starting a new one will discard it.</p>
        </Confirm>
      )}
      {dialog === 'ios' && (
        <Modal
          title="Install Pop Quiz"
          onClose={() => setDialog(null)}
          actions={
            <button type="button" class="btn btn-primary" onClick={() => setDialog(null)}>
              OK
            </button>
          }
        >
          <ol class="steps">
            <li>
              Tap the <strong>Share</strong> button <span aria-hidden="true">(□↑)</span> in Safari.
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>.
            </li>
            <li>
              Tap <strong>Add</strong>.
            </li>
          </ol>
          <p class="muted">Tip: finish each quiz in the same place you started it — the home-screen app and Safari keep separate progress.</p>
        </Modal>
      )}
    </>
  );
}
