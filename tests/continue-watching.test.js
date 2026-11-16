jest.mock('../build/src/models/watched.model', () => ({
  WatchedModel: {
    aggregate: jest.fn(),
    findOneAndDelete: jest.fn(),
  },
}))
jest.mock('../build/src/utils/MovieMediaSourcesUtils', () => ({
  MovieMediaSourcesUtils: { resolveMediaSources: jest.fn() },
}))
jest.mock('../build/src/repositories/VideoRepo', () => ({
  VideoRepo: { fetchById: jest.fn() },
}))
jest.mock('../build/src/models/userSettings.model', () => ({ SettingsModel: {} }))
jest.mock('../build/src/models/seasons.model', () => ({ SeasonModel: {} }))
jest.mock('../build/src/models/videos.model', () => ({ VideoModel: {} }))
jest.mock('../build/src/models/episodes.model', () => ({ EpisodeModel: {} }))
jest.mock('../build/src/services/core/AdminUploadService', () => ({ AdminUploadService: {} }))

const { WatchedModel } = require('../build/src/models/watched.model')
const { WatchedService } = require('../build/src/services/core/WatchedService')

describe('continue watching service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('only deletes a watched record owned by the current user', async () => {
    WatchedModel.findOneAndDelete.mockResolvedValue({ _id: 'watched-id' })

    await WatchedService.deleteById('watched-id', 'current-user-id')

    expect(WatchedModel.findOneAndDelete).toHaveBeenCalledWith({
      _id: 'watched-id',
      userId: 'current-user-id',
    })
  })

  test('sorts by most recently updated before updatedAt is projected out', async () => {
    WatchedModel.aggregate.mockResolvedValue([])

    await WatchedService.fetchContinueWatching(
      { _id: 'current-user-id', videoQuality: 'auto' },
      {},
    )

    const [pipeline] = WatchedModel.aggregate.mock.calls[0]
    const sortIndex = pipeline.findIndex(stage => stage.$sort)
    const projectIndex = pipeline.findIndex(stage => stage.$project)

    expect(pipeline[sortIndex]).toEqual({ $sort: { updatedAt: -1, _id: -1 } })
    expect(sortIndex).toBeGreaterThan(-1)
    expect(sortIndex).toBeLessThan(projectIndex)
  })
})
