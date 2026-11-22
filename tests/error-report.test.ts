import { describe, expect, it } from 'vitest'
import { createErrorBudget, describeError, MAX_ERROR_REPORTS } from '../src/lib/errors'

describe('describeError', () => {
  it('takes name and message from a real Error', () => {
    expect(describeError('render', new TypeError('x is not a function'))).toEqual({
      kind: 'render',
      name: 'TypeError',
      message: 'x is not a function',
    })
  })

  it('survives a thrown string, which has no name or message', () => {
    expect(describeError('global', 'boom')).toEqual({
      kind: 'global',
      name: 'Error',
      message: 'boom',
    })
  })

  it('survives a thrown object and an Event, which is not an Error at all', () => {
    expect(describeError('promise', { code: 'E_NETWORK' }).message).toBe('[object Object]')
    expect(describeError('global', null).message).toBe('null')
    expect(describeError('global', undefined).message).toBe('undefined')
  })

  it('collapses newlines and truncates to what a Firestore prop allows', () => {
    const multi = new Error(`line one\nline two\t${'x'.repeat(300)}`)
    const report = describeError('render', multi)
    expect(report.message).not.toContain('\n')
    expect(report.message).not.toContain('\t')
    expect(report.message.length).toBe(100)
  })

  it('keeps the error name even when the message is empty', () => {
    expect(describeError('render', new Error(''))).toEqual({
      kind: 'render',
      name: 'Error',
      message: '',
    })
  })
})

describe('createErrorBudget', () => {
  it('allows a bounded number of reports so a render loop cannot flood Firestore', () => {
    const budget = createErrorBudget()
    const taken = Array.from({ length: MAX_ERROR_REPORTS + 3 }, () => budget.take())
    expect(taken.filter(Boolean)).toHaveLength(MAX_ERROR_REPORTS)
    expect(taken.slice(MAX_ERROR_REPORTS).every((ok) => ok === false)).toBe(true)
  })

  it('respects an explicit limit', () => {
    const budget = createErrorBudget(2)
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false])
  })
})
