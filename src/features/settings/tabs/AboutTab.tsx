import { Row, SectionTitle } from '@/components/form'
import type { AboutInfo } from '@shared/models'
import type { PiHealth } from '@shared/models'
import { useEffect, useState } from 'react'

/** App and runtime versions, plus a pi version-drift warning. */

/** Newest pi minor pidex has been verified against (drift warning source). */
const VERIFIED_PI_MINOR = 78

export function AboutTab(): React.JSX.Element {
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [health, setHealth] = useState<PiHealth | null>(null)

  useEffect(() => {
    void window.pidex.invoke('app:about').then(setAbout)
    void window.pidex.invoke('pi:health').then(setHealth)
  }, [])

  const piMinor = health?.version ? Number(health.version.split('.')[1] ?? 0) : null
  const drift = piMinor !== null && piMinor > VERIFIED_PI_MINOR

  return (
    <div>
      <SectionTitle>About pidex</SectionTitle>
      <p className="text-text-secondary -mt-2 mb-4 text-[12.5px] leading-relaxed">
        A desktop coding-agent app powered by the{' '}
        <span className="font-medium">pi coding agent</span>. Sessions run as real{' '}
        <code className="font-mono">pi --mode rpc</code> subprocesses in your workspace.
      </p>

      <Row title="pidex version">
        <span className="font-mono text-[12.5px]">{about?.appVersion ?? '…'}</span>
      </Row>
      <Row title="pi version" description={health?.binaryPath}>
        <span className="font-mono text-[12.5px]">
          {health?.version ?? (health ? 'not found' : '…')}
        </span>
      </Row>
      <Row title="Platform">
        <span className="font-mono text-[12.5px]">
          {about ? `${about.platform}-${about.arch}` : '…'}
        </span>
      </Row>
      <Row title="Runtime">
        <span className="font-mono text-[12.5px]">
          {about ? `Electron ${about.electron} · Node ${about.node}` : '…'}
        </span>
      </Row>

      {drift && (
        <div className="bg-warning/10 border-warning/30 mt-4 rounded-lg border px-3.5 py-2.5 text-[12.5px]">
          <span className="font-medium">pi {health?.version} is newer than tested.</span>{' '}
          <span className="text-text-secondary">
            pidex is verified against pi 0.{VERIFIED_PI_MINOR}.x. Newer minors usually work, but
            protocol additions may not be surfaced yet.
          </span>
        </div>
      )}
    </div>
  )
}
