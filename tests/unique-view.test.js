jest.mock('../build/src/models/view.model', () => ({
  ViewModel: {
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  },
}))

jest.mock('../build/src/models/videos.model', () => ({
  VideoModel: {
    findByIdAndUpdate: jest.fn(),
  },
}))

jest.mock('../build/src/models/episodes.model', () => ({
  EpisodeModel: {
    findByIdAndUpdate: jest.fn(),
    findById: jest.fn(),
  },
}))

jest.mock('../build/src/models/seasons.model', () => ({
  SeasonModel: {
    findById: jest.fn(),
  },
}))

jest.mock('../build/src/models/lives.model', () => ({
  LiveModel: {
    findByIdAndUpdate: jest.fn(),
  },
}))

const { ViewModel } = require('../build/src/models/view.model')
const { VideoModel } = require('../build/src/models/videos.model')
const { EpisodeModel } = require('../build/src/models/episodes.model')
const { SeasonModel } = require('../build/src/models/seasons.model')
const { ViewService } = require('../build/src/services/core/ViewService')

describe('lifetime unique content views', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('increments a VOD only for the first view from the same account', async () => {
    ViewModel.updateOne
      .mockResolvedValueOnce({ upsertedCount: 1 })
      .mockResolvedValueOnce({ upsertedCount: 0 })
    VideoModel.findByIdAndUpdate.mockResolvedValue({ _id: 'vod-1' })

    const first = await ViewService.registerUniqueView({
      viewer: 'user-1',
      content: 'vod-1',
      contentType: 'vod',
    })
    const repeated = await ViewService.registerUniqueView({
      viewer: 'user-1',
      content: 'vod-1',
      contentType: 'vod',
    })

    expect(first).toEqual({ counted: true })
    expect(repeated).toEqual({ counted: false })
    expect(VideoModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
  })

  test('counts an episode once and rolls the viewer up once to its series', async () => {
    ViewModel.updateOne
      .mockResolvedValueOnce({ upsertedCount: 1 })
      .mockResolvedValueOnce({ upsertedCount: 1 })
    EpisodeModel.findByIdAndUpdate.mockResolvedValue({ _id: 'episode-1' })
    VideoModel.findByIdAndUpdate.mockResolvedValue({ _id: 'series-1' })
    EpisodeModel.findById.mockReturnValue({
      select: () => ({ session: async () => ({ season: 'season-1' }) }),
    })
    SeasonModel.findById.mockReturnValue({
      select: () => ({ session: async () => ({ video: 'series-1' }) }),
    })

    await ViewService.registerUniqueView({
      viewer: 'user-1',
      content: 'episode-1',
      contentType: 'episode',
    })

    expect(EpisodeModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
    expect(VideoModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
    expect(ViewModel.updateOne).toHaveBeenNthCalledWith(
      2,
      { viewer: 'user-1', content: 'series-1', contentType: 'vod' },
      expect.anything(),
      expect.objectContaining({ upsert: true }),
    )
  })

  test('requires the account/content/type compound unique index', () => {
    const { ViewModel: RealViewModel } = jest.requireActual('../build/src/models/view.model')
    const indexes = RealViewModel.schema.indexes()
    expect(indexes).toEqual(
      expect.arrayContaining([
        [{ viewer: 1, content: 1, contentType: 1 }, expect.objectContaining({ unique: true })],
      ]),
    )
  })
})
