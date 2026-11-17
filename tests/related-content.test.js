const mockAggregate = jest.fn()
const mockLean = jest.fn()
const mockSelect = jest.fn(() => ({ lean: mockLean }))
const mockFindById = jest.fn(() => ({ select: mockSelect }))

jest.mock('../build/src/env', () => ({
  __esModule: true,
  default: { CDN_IMAGES_BASE_URL: 'https://images.test' },
}))

jest.mock('../build/src/models/videos.model', () => ({
  VideoModel: {
    aggregate: mockAggregate,
    findById: mockFindById,
  },
}))

const { VideoRepo } = require('../build/src/repositories/VideoRepo')

describe('related content ranking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAggregate.mockResolvedValue([])
  })

  test('keeps results in the same content type and excludes the current title', async () => {
    const sourceId = '64b000000000000000000001'
    mockLean.mockResolvedValue({
      _id: sourceId,
      type: 'music-video',
      genre: ['64b000000000000000000002'],
      category: ['64b000000000000000000003'],
      cast: ['64b000000000000000000004'],
      artistName: 'Reeplay Artist',
    })

    await VideoRepo.fetchRelated({ vodId: sourceId, page: 1, limit: 6 })

    const [pipeline] = mockAggregate.mock.calls[0]
    const relatedMatch = pipeline.find(
      stage => stage.$match?.type === 'music-video' && stage.$match?.active === true,
    )
    const relatedSort = pipeline.find(stage => stage.$sort?.relatedScore === -1)

    expect(relatedMatch.$match._id.$ne.toString()).toBe(sourceId)
    expect(relatedSort.$sort).toEqual(
      expect.objectContaining({
        relatedScore: -1,
        engagements: -1,
        viewsCount: -1,
        createdAt: -1,
      }),
    )
  })

  test('rejects invalid VOD identifiers before querying MongoDB', async () => {
    await expect(
      VideoRepo.fetchRelated({ vodId: 'not-an-object-id', page: 1, limit: 6 }),
    ).resolves.toBeNull()
    expect(mockFindById).not.toHaveBeenCalled()
  })
})
