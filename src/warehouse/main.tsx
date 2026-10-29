import { mountApp } from '../shared/ui';
import { App } from './App';

// Toasts sit above the bottom tab bar.
mountApp(<App />, { toastBottomOffset: 76 });
