// Lists English strings used with t('…') / <Rich text="…"> that have no Malay or Chinese translation.
// Run: npm run i18n:check
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));
const files = [];
const walk = (dir) => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'i18n') walk(p); } else if (/\.(jsx?|mjs)$/.test(name)) files.push(p);
    }
};
walk(root);

const messages = {};
for (const name of readdirSync(join(root, 'i18n', 'messages'))) {
    const mod = await import(new URL(`../src/i18n/messages/${name}`, import.meta.url));
    Object.assign(messages, mod.default);
}

const CALL = /(?<![\w.])(?:t|translate)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
const RICH = /Rich text="([^"]*)"/g;
const missing = new Map();
for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const re of [CALL, RICH]) {
        for (const m of src.matchAll(re)) {
            const key = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"');
            const row = messages[key];
            if (!row || !row[0] || !row[1]) {
                if (!missing.has(key)) missing.set(key, relative(root, file));
            }
        }
    }
}

const bad = Object.entries(messages).filter(([, row]) => !Array.isArray(row) || row.length !== 2 || row.some((v) => typeof v !== 'string' || !v));
for (const [key] of bad) console.log(`malformed entry: ${key}`);
for (const [key, file] of missing) console.log(`missing: ${JSON.stringify(key)}  (${file})`);
console.log(`${Object.keys(messages).length} translated strings, ${missing.size} missing, ${bad.length} malformed.`);
process.exit(missing.size || bad.length ? 1 : 0);
