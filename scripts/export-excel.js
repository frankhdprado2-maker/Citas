import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ExcelStore } from '../lib/store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(process.env.DATA_DIR || join(root, 'data', 'registro'));
const store = new ExcelStore(directory);
const snapshot = await store.snapshot();
const outputDirectory = join(root, 'consultas');
await mkdir(outputDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(outputDirectory, `citas-${stamp}-${randomUUID().slice(0, 8)}.xlsx`);
await writeFile(destination, snapshot, { flag: 'wx' });
console.log(`Copia de consulta: ${destination}`);
console.log('Puedes abrir esta copia en Excel mientras la app sigue guardando nuevas salidas.');
