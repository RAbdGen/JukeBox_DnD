import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readStyles, styleFiles, STYLES_ENTRY } from './helpers/readStyles.js';

const stylesDir = join(dirname(STYLES_ENTRY), 'styles');

describe('styles.css découpé en fichiers', () => {
    it('importe chaque fichier de frontend/styles/ exactement une fois', () => {
        const imported = styleFiles().map(file => basename(file)).sort();
        const onDisk = readdirSync(stylesDir).filter(name => name.endsWith('.css')).sort();
        expect(imported).toEqual(onDisk);
    });

    // transitions-agent ignore en silence les fichiers de plus de 40 000 octets
    it('garde chaque fichier sous 40 000 octets', () => {
        for (const file of [STYLES_ENTRY, ...styleFiles()]) {
            expect(statSync(file).size, basename(file)).toBeLessThan(40_000);
        }
    });

    it('reconstitue tout le CSS, sans @import local restant', () => {
        const css = readStyles();
        expect(css).not.toMatch(/@import\s+['"]\./);
        for (const file of styleFiles()) {
            expect(css).toContain(readFileSync(file, 'utf-8'));
        }
        expect(css).toContain('[data-theme="parchemin"]');
    });
});
