const mockAggregate = jest.fn().mockResolvedValue([])

jest.mock('../build/src/env', () => ({
  __esModule: true,
  default: {CDN_IMAGES_BASE_URL: 'https://images.test'},
}))

jest.mock('../build/src/models/videos.model', () => ({
  VideoModel: {aggregate: mockAggregate},
}))

const {VideoRepo} = require('../build/src/repositories/VideoRepo')

describe('Top 10 repository query', () => {
  beforeEach(() => jest.clearAllMocks())

  test('preserves editorial rank and always limits public results to ten', async () => {
    const ids = Array.from(
      {length: 12},
      (_, index) => `64b0000000000000000000${String(index).padStart(2, '0')}`,
    )

    await VideoRepo.fetchTopTen(ids)

    const [pipeline] = mockAggregate.mock.calls[0]
    expect(pipeline.find(stage => stage.$match?.active === true)).toBeDefined()
    expect(pipeline.find(stage => stage.$sort?.topTenRank === 1)).toBeDefined()
    expect(pipeline.find(stage => stage.$limit != null).$limit).toBe(10)
  })
})
