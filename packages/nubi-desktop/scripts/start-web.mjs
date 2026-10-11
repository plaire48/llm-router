// The browser and Electron window share one real worker and native host.
process.env.NUBI_WEB_PORT||='4318';
await import('./start.mjs');
