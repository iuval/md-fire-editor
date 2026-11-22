import { describe, expect, it } from 'vitest'
import {
  beginTabDrag,
  currentTabDrag,
  dropIndexAt,
  dropZoneAt,
  endTabDrag,
} from '../src/lib/tabDrag'

/** A 1000×600 pane at the origin: the numbers in the tests are pixels. */
const rect = { left: 0, top: 0, width: 1000, height: 600 }

describe('tab drag: where a drop lands', () => {
  it('splits against the edge under the pointer', () => {
    expect(dropZoneAt(rect, 60, 300)).toBe('left')
    expect(dropZoneAt(rect, 940, 300)).toBe('right')
    expect(dropZoneAt(rect, 500, 40)).toBe('top')
    expect(dropZoneAt(rect, 500, 560)).toBe('bottom')
  })

  it('moves the tab in from the middle of the pane', () => {
    expect(dropZoneAt(rect, 500, 300)).toBe('center')
    // Just past the band: 30% of the width is 160px here, capped.
    expect(dropZoneAt(rect, 300, 300)).toBe('center')
    expect(dropZoneAt(rect, 700, 300)).toBe('center')
  })

  it('gives a corner to the edge the pointer is closest to', () => {
    // 40px from the top, 20px from the left: left is nearer.
    expect(dropZoneAt(rect, 20, 40)).toBe('left')
    // The other way round.
    expect(dropZoneAt(rect, 40, 20)).toBe('top')
    expect(dropZoneAt(rect, 980, 40)).toBe('right')
    expect(dropZoneAt(rect, 500, 590)).toBe('bottom')
  })

  it('keeps the band usable on a short pane instead of eating it whole', () => {
    const short = { left: 0, top: 0, width: 400, height: 120 }
    // 30% of 120 is 36px: the middle third is still the centre.
    expect(dropZoneAt(short, 200, 20)).toBe('top')
    expect(dropZoneAt(short, 200, 60)).toBe('center')
    expect(dropZoneAt(short, 200, 100)).toBe('bottom')
  })

  it('measures from the pane, not from the window', () => {
    const moved = { left: 700, top: 200, width: 300, height: 400 }
    expect(dropZoneAt(moved, 710, 400)).toBe('left')
    expect(dropZoneAt(moved, 990, 400)).toBe('right')
    expect(dropZoneAt(moved, 850, 400)).toBe('center')
  })

  it('falls back to the centre for a pane with no size yet', () => {
    expect(dropZoneAt({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe('center')
  })
})

describe('tab drag: where the insertion line goes', () => {
  const tabs = [
    { left: 0, top: 0, width: 100, height: 26 },
    { left: 102, top: 0, width: 100, height: 26 },
    { left: 204, top: 0, width: 100, height: 26 },
  ]

  it('counts the tabs whose middle is left of the pointer', () => {
    expect(dropIndexAt(tabs, 10)).toBe(0)
    expect(dropIndexAt(tabs, 49)).toBe(0)
    expect(dropIndexAt(tabs, 51)).toBe(1)
    expect(dropIndexAt(tabs, 160)).toBe(2)
    expect(dropIndexAt(tabs, 900)).toBe(3)
  })

  it('is zero on an empty strip', () => {
    expect(dropIndexAt([], 120)).toBe(0)
  })
})

describe('tab drag: the session', () => {
  it('remembers the dragged tab and forgets it at the end', () => {
    try {
      expect(currentTabDrag()).toBeNull()
      beginTabDrag({ paneId: 'p1', tabId: 't1' })
      expect(currentTabDrag()).toEqual({ paneId: 'p1', tabId: 't1' })
      endTabDrag()
      expect(currentTabDrag()).toBeNull()
    } finally {
      endTabDrag()
    }
  })
})
