import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Installing on phones: the manifest, icons and page settings the phone reads.
const manifest = JSON.parse(readFileSync('web/public/manifest.webmanifest', 'utf8'));
const html = readFileSync('web/index.html', 'utf8');

/** A PNG's width and height, from its header. */
function pngSize(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

describe('installing on phones', () => {
  it('has a manifest that opens full screen, from wherever the site is put online', () => {
    expect(manifest).toMatchObject({ name: 'SI Claim Forms', short_name: 'SI Claims', display: 'standalone', start_url: './', scope: './' });
  });

  it('has every icon it names, at the size it says, including one phones can crop to a circle', () => {
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const path = `web/public/${icon.src}`;
      expect(existsSync(path)).toBe(true);
      expect(pngSize(path)).toBe(icon.sizes);
    }
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    expect(pngSize('web/public/icons/apple-touch-icon.png')).toBe('180x180');
  });

  it('links the manifest and the iPhone icon from the page', () => {
    for (const tag of ['rel="manifest" href="./manifest.webmanifest"', 'rel="apple-touch-icon" href="./icons/apple-touch-icon.png"', 'name="theme-color"']) {
      expect(html).toContain(tag);
    }
  });

  it('keeps only the app\'s own files for offline use, never uploads or other sites', () => {
    const sw = readFileSync('web/public/sw.js', 'utf8');
    expect(sw).toContain("request.method !== 'GET'");
    expect(sw).toContain('origin !== self.location.origin');
  });
});
