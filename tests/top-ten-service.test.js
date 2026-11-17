const mockFindOneAndUpdate = jest.fn()
const mockFind = jest.fn()

jest.mock('../build/src/models/topTen.model', () => ({
  TopTenModel: {
    findOne: jest.fn(),
    findOneAndUpdate: mockFindOneAndUpdate,
  },
}))

jest.mock('../build/src/models/videos.model', () => ({
  VideoModel: {find: mockFind},
}))

jest.mock('../build/src/repositories/VideoRepo', () => ({
  VideoRepo: {fetchTopTen: jest.fn(), fetchTopTenCandidates: jest.fn()},
}))

jest.mock('../build/src/utils/guestAccess', () => ({filterGuestVods: value => value}))
jest.mock('../build/src/utils/MovieMediaSourcesUtils', () => ({
  MovieMediaSourcesUtils: {resolveMediaSources: value => value},
}))

const {
  TOP_TEN_LIMIT,
  TopTenService,
  normalizeTopTenVideoIds,
} = require('../build/src/services/core/TopTenService')

const ids = Array.from(
  {length: TOP_TEN_LIMIT + 1},
  (_, index) => `64b0000000000000000000${String(index).padStart(2, '0')}`,
)

describe('Top 10 enforcement', () => {
  beforeEach(() => jest.clearAllMocks())

  test('rejects an eleventh title before writing to MongoDB', async () => {
    expect(() => normalizeTopTenVideoIds(ids)).toThrow(
      'Top 10 cannot contain more than 10 titles',
    )
    await expect(TopTenService.replace(ids)).rejects.toThrow(
      'Top 10 cannot contain more than 10 titles',
    )
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects duplicate titles', () => {
    const id = '64b000000000000000000001'
    expect(() => normalizeTopTenVideoIds([id, id])).toThrow(
      'A title can only appear once in Top 10',
    )
  })
})
