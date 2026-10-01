import js from '@eslint/js';
import security from 'eslint-plugin-security';

export default [
    {
        ignores: [
            'node_modules/',
            'dist/',
            'test-results/',
            'playwright-report/',
        ],
    },
    js.configs.recommended,
    security.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ARGV: 'readonly',
                console: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],
            // These errors deliberately discard upstream diagnostics, which may
            // contain credentials or account data. Only fixed messages reach UI.
            'preserve-caught-error': 'off',
        },
    },
    {
        files: ['playwright.config.js'],
        languageOptions: { globals: { process: 'readonly' } },
    },
    {
        // These callbacks execute in the docs page; GJS has no DOM globals.
        files: ['tests/docs.spec.js'],
        languageOptions: {
            globals: {
                document: 'readonly',
                getComputedStyle: 'readonly',
                URL: 'readonly',
            },
        },
    },
];
