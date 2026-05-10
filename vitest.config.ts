import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    extensions: ['.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.fixture.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['json', 'lcov', 'text', 'clover'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/types.ts',
        'src/index.ts',
        'src/**/constants/*',
        '**/.guard.ts',
      ],
      all: true,
    },
    coverageThreshold: {
      global: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
