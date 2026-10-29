import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('E2E_PORT must be a valid unprivileged port.');
const buildDir = process.env.E2E_BUILD_DIR ?? 'artifacts/e2e-dist';
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

// Test builds are explicitly demo-only and isolated from the production output directory.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
      : undefined,
    baseURL: `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `VITE_DATA_MODE=mock npm exec -- vite build --outDir ${shellQuote(buildDir)} && npm exec -- vite preview --outDir ${shellQuote(buildDir)} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
