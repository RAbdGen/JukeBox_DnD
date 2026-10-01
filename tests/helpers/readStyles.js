import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STYLES_ENTRY = fileURLToPath(new URL('../../frontend/styles.css', import.meta.url));

// @import d'un fichier local (pas les url(...) externes comme Google Fonts)
const LOCAL_IMPORT = /@import\s+['"](\.[^'"]+)['"]\s*;/g;

/** Fichiers CSS locaux importés par le point d'entrée, dans l'ordre de la cascade */
export function styleFiles(entry = STYLES_ENTRY) {
    const css = readFileSync(entry, 'utf-8');
    return [...css.matchAll(LOCAL_IMPORT)].map(match => resolve(dirname(entry), match[1]));
}

/**
 * CSS complet tel que Vite le regroupe : chaque @import local remplacé par le
 * contenu du fichier, dans l'ordre. Les tests de thème/scrollbar le lisent
 * comme l'ancien styles.css monolithique.
 */
export function readStyles(entry = STYLES_ENTRY) {
    const css = readFileSync(entry, 'utf-8');
    return css.replace(LOCAL_IMPORT, (_, relative) => readStyles(resolve(dirname(entry), relative)));
}
