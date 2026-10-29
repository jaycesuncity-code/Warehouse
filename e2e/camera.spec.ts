import { expect, test } from '@playwright/test';
import qrcode from 'qrcode-generator';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partId } from './helpers';

/** Write a short YUV4MPEG2 video of a QR code, for Chromium's fake camera. */
function makeY4m(text: string, file: string, W = 640, H = 480, frames = 20): void {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const scale = Math.floor(Math.min(W, H) / (n + quiet * 2));
  const size = (n + quiet * 2) * scale;
  const ox = Math.floor((W - size) / 2);
  const oy = Math.floor((H - size) / 2);
  const y = Buffer.alloc(W * H, 255);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          y[(oy + (r + quiet) * scale + dy) * W + ox + (c + quiet) * scale + dx] = 0;
    }
  const u = Buffer.alloc((W / 2) * (H / 2), 128);
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, u]);
  writeFileSync(file, Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]));
}

const dir = mkdtempSync(join(tmpdir(), 'sc-cam-'));
const video = join(dir, 'label.y4m');
// CU-34-90's ID is fixed in demo-data.ts (checked in the test below).
makeY4m('prt-k7m2qx9d', video);

// Chromium's fake camera plays this video instead of a real device.
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  },
});

test.describe('camera path with a fake camera showing a label', () => {
  test('the viewfinder reads the QR and opens the part', async ({ page }) => {
    await page.goto('/warehouse/?latency=0#/scan');
    await page.waitForFunction(() => !!window.__sc);
    expect(await partId(page, 'CU-34-90')).toBe('prt-k7m2qx9d');
    await expect(page.getByTestId('part-code')).toHaveText('CU-34-90', { timeout: 20_000 });
  });
});

test.describe('no camera available', () => {
  test('shows a friendly state and the typed lookup still works', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.reject(new DOMException('no', 'NotFoundError')) },
        configurable: true,
      });
    });
    await page.goto('/warehouse/?latency=0#/scan');
    await expect(page.getByTestId('camera-message')).toContainText('No camera found');
    await page.getByTestId('lookup-input').fill('CU-34-90');
    await expect(page.getByTestId('part-row')).toHaveCount(1);
  });

  test('permission denied explains how to fix it and offers Try again', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.reject(new DOMException('no', 'NotAllowedError')) },
        configurable: true,
      });
    });
    await page.goto('/warehouse/?latency=0#/scan');
    await expect(page.getByTestId('camera-message')).toContainText('Camera is blocked');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
