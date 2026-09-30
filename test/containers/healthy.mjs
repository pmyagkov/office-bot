import { writeFileSync } from 'node:fs';
import { openStore } from './dist/store.js';
const store = openStore('/app/data/office.db');
store.set('sentinel', 'survives rollback');
const beat = () => writeFileSync('/app/data/heartbeat.json', JSON.stringify({ at: Date.now(), pid: process.pid }));
beat();
setInterval(beat, 1000);
process.on('SIGTERM', () => { store.close(); process.exit(0); });
