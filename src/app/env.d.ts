declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface Navigator {
  /** iOS Safari: true when launched from the home screen. */
  standalone?: boolean;
}
