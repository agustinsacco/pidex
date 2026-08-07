#!/usr/bin/env node
/**
 * Regenerate the platform icon assets from build/icon.svg.
 *
 *   node scripts/generate-icons.mjs
 *
 * Renders the SVG with Playwright's bundled Chromium (already a
 * devDependency) so the rasterization matches what the renderer would
 * paint — no extra image tooling as a dependency. Produces:
 *
 *   build/icon.png   1024×1024 (linux; install.sh downloads this)
 *   build/icon.icns  macOS (via `iconutil`, so darwin-only)
 *   build/icon.ico   windows (via `npx png-to-ico`, network on first run)
 *
 * Maintainer script — not part of the build; run it when the mark changes
 * and commit the regenerated binaries.
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const tmp = join(buildDir, '.icon-tmp')
const svg = readFileSync(join(buildDir, 'icon.svg'), 'utf8')

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

/** macOS iconset naming: logical size → [filename, pixel size]. */
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

const browser = await chromium.launch()
try {
  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    )
    // omitBackground keeps the tile's rounded corners transparent.
    const png = await page.screenshot({ omitBackground: true })
    writeFileSync(join(tmp, `icon-${size}.png`), png)
    await page.close()
  }
} finally {
  await browser.close()
}

// linux / install.sh
copyFileSync(join(tmp, 'icon-1024.png'), join(buildDir, 'icon.png'))
console.log('✓ build/icon.png (1024)')

// macOS
if (process.platform === 'darwin') {
  const iconset = join(tmp, 'icon.iconset')
  mkdirSync(iconset)
  for (const [name, px] of ICONSET) {
    copyFileSync(join(tmp, `icon-${px}.png`), join(iconset, name))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')])
  console.log('✓ build/icon.icns')
} else {
  console.log('– skipped icon.icns (iconutil is darwin-only)')
}

// windows
try {
  const ico = execFileSync(
    'npx',
    ['-y', 'png-to-ico', ...[256, 128, 64, 48, 32, 16].map((s) => join(tmp, `icon-${s}.png`))],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  writeFileSync(join(buildDir, 'icon.ico'), ico)
  console.log('✓ build/icon.ico')
} catch (error) {
  console.warn(`– skipped icon.ico (png-to-ico failed: ${error.message})`)
}

rmSync(tmp, { recursive: true, force: true })
