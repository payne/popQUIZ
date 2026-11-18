import { render } from 'preact';
import { App } from './App.tsx';
import { initPwa } from './pwa.ts';
import { recordOpen } from './usage.ts';
import './styles.css';

initPwa();
void recordOpen();
render(<App />, document.getElementById('app')!);
