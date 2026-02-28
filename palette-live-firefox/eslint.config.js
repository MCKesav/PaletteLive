const globals = require('globals');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
                // Service worker globals (background.js runs as a service worker)
                importScripts: 'readonly',
                // PaletteLive globals (from content scripts and loaded scripts)
                MessageTypes: 'readonly',
                PLConfig: 'readonly',
                PLLog: 'readonly',
                ColorUtils: 'readonly',
                ColorNames: 'readonly',
                ColorScience: 'readonly',
                ContrastUtils: 'readonly',
                StorageUtils: 'readonly',
                ExporterUtils: 'readonly',
                Extractor: 'readonly',
                Injector: 'readonly',
                Heatmap: 'readonly',
                Dropper: 'readonly',
                ShadowWalker: 'readonly',
            },
        },
        rules: {
            // ── Errors ──
            'no-undef': 'error',
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrors: 'none', // intentionally-ignored catch variables are allowed
                },
            ],
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-unreachable': 'error',
            'no-constant-condition': 'warn',
            'no-empty': ['warn', { allowEmptyCatch: true }],

            // ── Best Practices ──
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-with': 'error',
            'no-throw-literal': 'error',
            'prefer-const': ['warn', { destructuring: 'all' }],

            // ── Security ──
            'no-script-url': 'error',

            // ── Style (minimal — Prettier handles formatting) ──
            'no-var': 'warn',
            'no-console': 'off', // Extension uses console.log for debugging
        },
    },
    {
        // Test files
        files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
        languageOptions: {
            globals: {
                ...globals.jest,
                ...globals.node,
            },
        },
    },
    {
        ignores: ['node_modules/**', 'dist/**', 'build/**'],
    },
];
