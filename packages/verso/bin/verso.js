#!/usr/bin/env node
globalThis.IS_SERVER = true;
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
await jiti.import('../src/verso/cli.ts');
