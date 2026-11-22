// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ErrorBoundary } from '../src/components/ErrorBoundary'

// The boundary imports the reporter lazily, so the mock has to cover the same
// module id the dynamic import resolves to.
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('../src/lib/errors.ts', () => ({ reportError }))

let roots: Root[] = []

function mount(ui: React.ReactNode) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(ui))
  return host
}

function Boom(): never {
  throw new Error('kaboom')
}

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()))
  roots = []
  document.body.innerHTML = ''
  reportError.mockClear()
})

// React prints caught render errors with console.error; the suite does not need
// the noise, but the assertion below is on our own reporter.
const silence = () => vi.spyOn(console, 'error').mockImplementation(() => undefined)

describe('ErrorBoundary', () => {
  it('renders the children when nothing throws', () => {
    const host = mount(
      <ErrorBoundary>
        <p>todo bien</p>
      </ErrorBoundary>
    )
    expect(host.textContent).toBe('todo bien')
  })

  it('replaces a crashed tree with a way out instead of a white screen', () => {
    const spy = silence()
    const host = mount(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(host.textContent).toContain('Something broke')
    expect(host.textContent).toContain('Reload')
    expect(host.querySelector('button')?.className).toContain('btn')
    spy.mockRestore()
  })

  it('reports the crash through lib/errors, naming the component that broke', async () => {
    const spy = silence()
    mount(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    await vi.waitFor(() => expect(reportError).toHaveBeenCalled())
    const [kind, detail] = reportError.mock.calls[0]
    expect(kind).toBe('render')
    expect(String(detail)).toContain('kaboom')
    spy.mockRestore()
  })
})
