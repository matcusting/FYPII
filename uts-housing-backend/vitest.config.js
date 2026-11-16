import 'dotenv/config';
import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL || 'postgresql://uts:uts_dev_password@localhost:5432/uts_housing_test';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', DATABASE_URL: testDb, UPLOAD_DIR: 'uploads-test', PRIVATE_UPLOAD_DIR: 'private-uploads-test' },
    globalSetup: './tests/global-setup.js',
    fileParallelism: false,
    testTimeout: 20000,
  },
});
