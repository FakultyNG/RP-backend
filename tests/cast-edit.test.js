jest.mock('../build/src/repositories/CastEnumRepo', () => ({ CastEnumRepo: {} }))
jest.mock('../build/src/services/media-management', () => ({
  MediaManagement: {
    storeImageAndSubtitle: jest.fn(),
    deleteObject: jest.fn(),
  },
}))
jest.mock('../build/src/models/castEnum.model', () => ({
  CastEnumModel: { findById: jest.fn() },
}))
jest.mock('../build/src/utils/photoUtils', () => ({ PhotoUtils: {} }))
jest.mock('../build/src/models/videos.model', () => ({ VideoModel: {} }))

const { CastEnumModel } = require('../build/src/models/castEnum.model')
const { MediaManagement } = require('../build/src/services/media-management')
const { CastEnumService } = require('../build/src/services/core/CastEnumService')

describe('cast editing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('updates cast details and replaces the image before removing the old image', async () => {
    const cast = {
      title: 'Actor',
      name: 'Old name',
      description: 'Old details',
      link: 'https://old.example',
      selectButtonType: 'fan-page',
      key: 'old-key',
      bucket: 'old-bucket',
      save: jest.fn().mockResolvedValue(undefined),
    }
    CastEnumModel.findById.mockResolvedValue(cast)
    MediaManagement.storeImageAndSubtitle.mockResolvedValue({
      Key: 'new-key',
      Bucket: 'new-bucket',
    })
    MediaManagement.deleteObject.mockResolvedValue(true)

    await CastEnumService.editCast({
      castId: 'cast-id',
      title: 'Director',
      name: 'New name',
      description: 'New details',
      link: 'https://new.example',
      selectButtonType: 'book-now',
      photoFile: { mimetype: 'image/jpeg' },
    })

    expect(cast).toMatchObject({
      title: 'Director',
      name: 'New name',
      description: 'New details',
      link: 'https://new.example',
      selectButtonType: 'book-now',
      key: 'new-key',
      bucket: 'new-bucket',
    })
    expect(cast.save).toHaveBeenCalledTimes(1)
    expect(MediaManagement.deleteObject).toHaveBeenCalledWith('old-key', 'old-bucket')
    expect(cast.save.mock.invocationCallOrder[0]).toBeLessThan(
      MediaManagement.deleteObject.mock.invocationCallOrder[0],
    )
  })
})
