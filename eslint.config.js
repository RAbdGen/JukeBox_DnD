import js from '@eslint/js';
import globals from 'globals';

// Règles recommandées d'ESLint, réglées par environnement : le renderer tourne
// dans le navigateur d'Electron, backend/ est partagé entre renderer et main
// (ESM), electron/ est en CommonJS, les tests tournent sous Node (Vitest).
export default [
    { ignores: ['dist/', 'build/', 'node_modules/', 'docs/'] },
    js.configs.recommended,
    {
        rules: {
            // Un paramètre inutilisé en tête de signature (callback IPC, écouteur)
            // garde souvent l'ordre des arguments : seuls les inutilisés préfixés _ sont tolérés
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
        },
    },
    {
        files: ['frontend/**/*.js'],
        languageOptions: { globals: { ...globals.browser } },
    },
    {
        files: ['backend/**/*.js'],
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
    },
    {
        files: ['electron/**/*.cjs', 'scripts/**/*.cjs'],
        languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    },
    {
        files: ['tests/**/*.js', '*.config.js', 'vite.config.js'],
        languageOptions: { globals: { ...globals.node } },
    },
];
