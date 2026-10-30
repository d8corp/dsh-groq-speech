// jest.config.ts
export default {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['.*.speed.test.ts$', 'speed-test', '<rootDir>/.deploy/'],
  modulePathIgnorePatterns: ['<rootDir>/release/', '<rootDir>/lib/'],
  coverageDirectory: 'docs/coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@deepseek-ai/dsh-llm$': '<rootDir>/test/fixtures/dsh-llm-stub.ts',
    '^react$': '<rootDir>/test/fixtures/react-stub.ts',
    '^react/jsx-runtime$': '<rootDir>/test/fixtures/react-stub.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: { ignoreCodes: [1343] },
        astTransformers: {
          before: [
            {
              path: 'node_modules/ts-jest-mock-import-meta',
              options: {
                metaObjectReplacement: {},
              },
            },
          ],
        },
      },
    ],
  },
}
