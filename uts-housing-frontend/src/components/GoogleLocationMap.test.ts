import { describe, expect, it } from 'vitest'
import { visibleExactPin } from './GoogleLocationMap'

describe('listing location privacy', () => {
  it('keeps a saved exact pin private until the owner opts in', () => {
    const privateListing = { latitude: 2.286, longitude: 111.835, address: 'Example Street', showExactLocation: false }
    expect(visibleExactPin(privateListing)).toBeNull()
    expect(visibleExactPin({ ...privateListing, showExactLocation: true })).toEqual({ latitude: 2.286, longitude: 111.835, address: 'Example Street' })
  })

  it('does not publish invalid coordinates', () => {
    expect(visibleExactPin({ latitude: 100, longitude: 111.835, showExactLocation: true })).toBeNull()
    expect(visibleExactPin({ latitude: 2.286, longitude: null, showExactLocation: true })).toBeNull()
  })
})
