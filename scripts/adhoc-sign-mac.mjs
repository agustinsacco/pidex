/**
 * `afterPack` hook: ad-hoc sign the macOS bundle when there is no Developer ID.
 *
 * Electron's prebuilt binary ships `linker-signed` with `Identifier=Electron`
 * and NO sealed resources. When electron-builder has no certificate it skips
 * signing entirely (`identity=null` skips it too — it does not ad-hoc sign),
 * so that stock signature is what shipped: v0.1.90's `.dmg` and `-mac.zip`
 * both failed `codesign --verify` with
 *
 *     code has no resources but signature indicates they must be present
 *
 * which Finder reports as "damaged and can't be opened". Dev never caught it
 * because `npm run dev` execs the binary directly — Gatekeeper only assesses
 * files carrying `com.apple.quarantine`, which a download has and an npm
 * tarball does not.
 *
 * `codesign --sign -` re-signs the bundle properly: identifier becomes
 * `works.pidex.app` and the resource seal is written, so the bundle verifies.
 * It is still ad-hoc — `spctl` says `rejected` rather than accepting it — but
 * "unsigned by anyone" is a normal right-click → Open, not a damaged app.
 *
 * Runs BEFORE the dmg/zip targets are cut, so both artifacts carry the fixed
 * signature. A no-op when a real certificate is present: electron-builder has
 * already signed and notarized by then, and re-signing ad-hoc would strip that.
 */
import { execFileSync } from 'node:child_process'

export default async function adhocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  // A real Developer ID is strictly better and electron-builder applies it
  // itself; never clobber that signature with an ad-hoc one.
  if (process.env.CSC_LINK) {
    console.log('  • adhoc-sign skipped — CSC_LINK present, electron-builder signs')
    return
  }

  const app = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`

  // --deep so nested Helpers and Frameworks are sealed too; an unsealed
  // nested bundle fails verification of the parent. --force replaces the
  // stock linker signature rather than erroring on it.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], {
    stdio: 'inherit',
  })

  // Verify here, not in a later job: a broken signature must fail the build
  // that produced it, not surface as a "damaged app" on a user's Mac.
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })

  console.log(`  • adhoc-signed and verified ${app}`)
}
