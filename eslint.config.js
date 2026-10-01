import js from '@eslint/js';
import security from 'eslint-plugin-security';

export default [
    { ignores: ['node_modules/', 'dist/'] },
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
];
