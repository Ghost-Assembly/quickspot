import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: [
                'modules/**/*.js',
                'extension.js',
                'prefs.js',
                'scripts/soloist-runner.js',
            ],
            exclude: ['tests/**'],
        },
    },
});
