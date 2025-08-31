export { StackgazerApp } from './StackTraceApp.js';
export { AppSettings } from '../app/SettingsManager.js';

// Make StackgazerApp available globally for the HTML
import { StackgazerApp } from './StackTraceApp.js';
(window as any).StackgazerApp = StackgazerApp;
