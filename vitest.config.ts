import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.fixture.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['json', 'lcov', 'text', 'clover'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/types/**/*.ts',
        'src/index.ts',
        'src/**/constants/*',
        // Entrypoint bootstrap: render()/TTY/process.exit, not unit-testable
        // (analogous to the excluded src/index.ts).
        'src/tui/index.tsx',
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
