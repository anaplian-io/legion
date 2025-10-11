export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.jest.json' }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1', // remove .js extensions for Jest
  },
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'lcov', 'text', 'clover'],
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    'initialization.ts',
    '\\.guard\\.ts$',
    '/src/constants/',
    '/src/index.ts',
    '/src/types/',
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  transformIgnorePatterns: ['/node_modules/'],
};
