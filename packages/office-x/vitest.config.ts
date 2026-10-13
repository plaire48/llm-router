import { defineConfig } from 'vitest/config';
import {fileURLToPath} from 'node:url';
// Match the production bundle's transport-only Nubi adapter.
export default defineConfig({resolve:{alias:[{find:/.*\/agent-runtime\.js$/,replacement:fileURLToPath(new URL('./runtime-src/nubi-wire.mjs',import.meta.url))}]},test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
