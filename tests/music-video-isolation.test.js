const mockAggregate = jest.fn().mockResolvedValue([])
const mockCategoryLean = jest.fn()
const mockCategorySelect = jest.fn(() => ({lean: mockCategoryLean}))
const mockCategoryFindById = jest.fn(() => ({select: mockCategorySelect}))

jest.mock('../build/src/env', () => ({
  __esModule: true,
  default: {CDN_IMAGES_BASE_URL: 'https://images.test'},
}))

jest.mock('../build/src/models/videos.model', () => ({
  VideoModel: {aggregate: mockAggregate},
}))

jest.mock('../build/src/models/categoryEnum.model', () => ({
  CategoryEnumModel: {findById: mockCategoryFindById},
}))

const {VideoRepo} = require('../build/src/repositories/VideoRepo')

const categoryId = '64b000000000000000000001'

describe('music-video catalogue isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAggregate.mockResolvedValue([])
  })

  test('excludes music videos from recommendations and public Top 10', async () => {
    await VideoRepo.fetchPersonalizedCandidates(20)
    let [pipeline] = mockAggregate.mock.calls[0]
    expect(pipeline.find(stage => stage.$match?.type?.$ne === 'music-video')).toBeDefined()

    await VideoRepo.fetchTopTen([categoryId])
    ;[pipeline] = mockAggregate.mock.calls[1]
    expect(pipeline.find(stage => stage.$match?.type?.$ne === 'music-video')).toBeDefined()
  })

  test('keeps music videos in a named music-video category only', async () => {
    mockCategoryLean.mockResolvedValueOnce({name: 'Music Videos'})
    await VideoRepo.fetchByCategory(categoryId, 1, 12)
    let [pipeline] = mockAggregate.mock.calls[0]
    expect(pipeline.find(stage => stage.$match?.type === 'music-video')).toBeDefined()

    mockCategoryLean.mockResolvedValueOnce({name: 'Drama'})
    await VideoRepo.fetchByCategory(categoryId, 1, 12)
    ;[pipeline] = mockAggregate.mock.calls[1]
    expect(pipeline.find(stage => stage.$match?.type?.$ne === 'music-video')).toBeDefined()
  })

  test('allows music videos in Featured while default Library excludes them', async () => {
    await VideoRepo.fetchFeatured(1, 10)
    let [pipeline] = mockAggregate.mock.calls[0]
    expect(pipeline.some(stage => stage.$match?.type)).toBe(false)

    await VideoRepo.fetchLibrary({page: 1, limit: 20})
    ;[pipeline] = mockAggregate.mock.calls[1]
    expect(pipeline.find(stage => stage.$match?.type?.$ne === 'music-video')).toBeDefined()

    await VideoRepo.fetchLibrary({page: 1, limit: 20, type: 'music-video'})
    ;[pipeline] = mockAggregate.mock.calls[2]
    expect(pipeline.find(stage => stage.$match?.type === 'music-video')).toBeDefined()
  })
})
