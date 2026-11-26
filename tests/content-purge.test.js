const mockFindVideoUpload = jest.fn()
const mockDeleteVideoUpload = jest.fn()

jest.mock('../build/src/models/videoupload.model', () => ({
  VideoUploadModel: {
    findById: (...args) => mockFindVideoUpload(...args),
    findByIdAndDelete: (...args) => mockDeleteVideoUpload(...args),
  },
}))
jest.mock('../build/src/models/subtitle.model', () => ({
  SubtitleModel: { find: jest.fn(async () => []), findByIdAndDelete: jest.fn() },
}))
jest.mock('../build/src/models/seasons.model', () => ({
  SeasonModel: { find: jest.fn(async () => []), findByIdAndDelete: jest.fn() },
}))
jest.mock('../build/src/models/episodes.model', () => ({
  EpisodeModel: { find: jest.fn(async () => []), findByIdAndDelete: jest.fn() },
}))
jest.mock('../build/src/models/payments.model', () => ({
  PaymentModel: { findByIdAndDelete: jest.fn() },
}))

const mockListKeys = jest.fn()
const mockDeleteObjects = jest.fn()
const mockDeleteObject = jest.fn()
jest.mock('../build/src/services/aws/s3', () => ({
  S3: {
    listKeys: (...args) => mockListKeys(...args),
    deleteObjects: (...args) => mockDeleteObjects(...args),
    deleteObject: (...args) => mockDeleteObject(...args),
  },
}))

const mockGetJob = jest.fn()
const mockCancelJob = jest.fn()
jest.mock('../build/src/services/aws/mediaConvert', () => ({
  MediaConvert: {
    getJob: (...args) => mockGetJob(...args),
    cancelJob: (...args) => mockCancelJob(...args),
    getHlsPrefix: key => `railway-hls/${key}`,
  },
}))

const { Purge } = require('../build/src/utils/Purge')

const uploadDocument = () => ({
  _id: 'upload-1',
  bucket: 'media-bucket',
  key: 'source/movie.mp4',
  resolutions: [{ resolution: '720', key: 'transcode/source/movie.mp4_720p.mp4' }],
  hlsKey: 'railway-hls/source/movie.mp4/master.m3u8',
  hlsJobId: 'job-1',
})

describe('content S3 purge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindVideoUpload.mockResolvedValue(uploadDocument())
    mockGetJob.mockResolvedValue({ Status: 'PROGRESSING' })
    mockListKeys.mockImplementation(async prefix =>
      prefix.startsWith('railway-hls/')
        ? ['railway-hls/source/movie.mp4/master.m3u8', 'railway-hls/source/movie.mp4/segment.ts']
        : ['transcode/source/movie.mp4_480p.mp4'],
    )
    mockDeleteObjects.mockResolvedValue(undefined)
    mockDeleteObject.mockResolvedValue(undefined)
    mockDeleteVideoUpload.mockResolvedValue(undefined)
  })

  test('cancels active transcoding and deletes source, MP4, and complete HLS output', async () => {
    await Purge.videoUploadById('upload-1')

    expect(mockCancelJob).toHaveBeenCalledWith('job-1')
    expect(mockListKeys).toHaveBeenCalledWith('transcode/source/movie.mp4', 'media-bucket')
    expect(mockListKeys).toHaveBeenCalledWith('railway-hls/source/movie.mp4/', 'media-bucket')
    expect(mockDeleteObjects).toHaveBeenCalledWith(
      expect.arrayContaining([
        'source/movie.mp4',
        'transcode/source/movie.mp4_720p.mp4',
        'transcode/source/movie.mp4_480p.mp4',
        'railway-hls/source/movie.mp4/master.m3u8',
        'railway-hls/source/movie.mp4/segment.ts',
      ]),
      'media-bucket',
    )
    expect(mockDeleteVideoUpload).toHaveBeenCalledWith('upload-1')
  })

  test('retains the upload record when S3 cleanup fails so deletion can be retried', async () => {
    mockDeleteObjects.mockRejectedValueOnce(new Error('S3 unavailable'))

    await expect(Purge.videoUploadById('upload-1')).rejects.toThrow('S3 unavailable')
    expect(mockDeleteVideoUpload).not.toHaveBeenCalled()
  })

  test('deletes both VOD posters', async () => {
    const video = {
      _id: 'video-1',
      type: 'movie',
      videoUpload: null,
      trailerUpload: null,
      portraitPhoto: { Key: 'portrait.webp', Bucket: 'images-bucket' },
      landscapePhoto: { Key: 'landscape.webp', Bucket: 'images-bucket' },
    }

    await Purge.vod(video)

    expect(mockDeleteObject).toHaveBeenCalledWith('portrait.webp', 'images-bucket')
    expect(mockDeleteObject).toHaveBeenCalledWith('landscape.webp', 'images-bucket')
  })
})
