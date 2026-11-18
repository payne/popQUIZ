import { render } from 'preact';
import { App } from './App.tsx';
import { initPwa } from './pwa.ts';
import './styles.css';

initPwa();
render(<App />, document.getElementById('app')!);
