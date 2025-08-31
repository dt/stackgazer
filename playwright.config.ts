import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/benchmarks.spec.ts',
  fullyParallel: false, // Run benchmarks sequentially for accurate timing
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1, // Single worker for consistent performance measurements
  reporter: 'line',
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  // Use file:// URL instead of HTTP server
  // webServer: {
  //   command: 'npm run serve',
  //   port: 8000,
  //   reuseExistingServer: !process.env.CI,
  // },
});