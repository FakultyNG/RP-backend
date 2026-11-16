const {
  AUTO_FEATURED_LIMIT,
  AUTO_REFEATURE_BLOCK_MS,
  getAutomaticFeaturedSlots,
  scoreAutoFeaturedCandidate,
} = require('../build/src/services/core/AutoFeaturedService')

describe('automatic featured selection', () => {
  test('fills only the unused portion of the ten featured slots', () => {
    expect(AUTO_FEATURED_LIMIT).toBe(10)
    expect(getAutomaticFeaturedSlots(0)).toBe(10)
    expect(getAutomaticFeaturedSlots(3)).toBe(7)
    expect(getAutomaticFeaturedSlots(9)).toBe(1)
    expect(getAutomaticFeaturedSlots(10)).toBe(0)
    expect(getAutomaticFeaturedSlots(15)).toBe(0)
  })

  test('blocks expired selections from immediate automatic reselection', () => {
    expect(AUTO_REFEATURE_BLOCK_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  test('ranks stronger quality engagement above raw low-quality traffic', () => {
    const base = {
      id: 'content',
      model: 'video',
      owner: 'owner',
      type: 'movie',
      rating: 4.5,
      ageDays: 5,
    }
    const qualityEngagement = scoreAutoFeaturedCandidate({
      ...base,
      views: 1_000,
      likes: 180,
      comments: 60,
    })
    const weakEngagement = scoreAutoFeaturedCandidate({
      ...base,
      views: 1_000,
      likes: 2,
      comments: 0,
    })

    expect(qualityEngagement).toBeGreaterThan(weakEngagement)
  })

  test('uses recent completion, watch and sharing signals when analytics exist', () => {
    const base = {
      id: 'content',
      model: 'video',
      owner: 'owner',
      type: 'movie',
      views: 500,
      likes: 20,
      comments: 5,
      rating: 4,
      ageDays: 10,
      recentUniqueViewers: 100,
      previousUniqueViewers: 100,
      playStarts: 100,
      averageDurationSeconds: 1_200,
    }

    const engaged = scoreAutoFeaturedCandidate({
      ...base,
      watchSeconds: 96_000,
      completions: 80,
      shares: 12,
    })
    const abandoned = scoreAutoFeaturedCandidate({
      ...base,
      watchSeconds: 12_000,
      completions: 5,
      shares: 0,
    })

    expect(engaged).toBeGreaterThan(abandoned)
  })
})
