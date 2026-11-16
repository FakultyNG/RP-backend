const sharp = require('sharp')

let mockUploadParams

jest.mock('../build/src/services/aws/s3', () => ({
  S3: {
    upload: jest.fn(async params => {
      mockUploadParams = params
      return {
        Key: 'optimized-image-key',
        Bucket: params.Bucket,
        $metadata: { httpStatusCode: 200 },
      }
    }),
    deleteObject: jest.fn(),
  },
}))
jest.mock('../build/src/services/aws/utils', () => ({
  AwsUtils: { buckets: { replayImages: 'images-test', reeplay: 'video-test' } },
}))
jest.mock('../build/src/services/aws/mediaConvert', () => ({
  MediaConvert: { transcode: jest.fn() },
}))

const { MediaManagement } = require('../build/src/services/media-management')

const imageFile = (buffer, mimetype = 'image/png') => ({
  buffer,
  mimetype,
  size: buffer.length,
  filename: 'poster.png',
  originalname: 'poster.png',
  fieldname: 'poster',
  encoding: '7bit',
})

describe('image upload optimization', () => {
  beforeEach(() => {
    mockUploadParams = undefined
  })

  test.each([
    ['portrait-poster', 2400, 3200, 1200, 1600],
    ['landscape-poster', 3840, 2160, 1920, 1080],
  ])('converts %s uploads to bounded WebP', async (preset, width, height, outWidth, outHeight) => {
    const original = await sharp({
      create: { width, height, channels: 3, background: '#7b1f24' },
    })
      .png()
      .toBuffer()

    const result = await MediaManagement.storeImageAndSubtitle(
      imageFile(original),
      undefined,
      preset,
    )
    const metadata = await sharp(mockUploadParams.Body).metadata()

    expect(mockUploadParams.ContentType).toBe('image/webp')
    expect(metadata).toMatchObject({ format: 'webp', width: outWidth, height: outHeight })
    expect(result).toMatchObject({ mimetype: 'image/webp', size: mockUploadParams.Body.length })
  })

  test('rejects images larger than 25 MB before upload', async () => {
    await expect(
      MediaManagement.storeImageAndSubtitle(
        {...imageFile(Buffer.alloc(1)), size: 25 * 1024 * 1024 + 1},
      ),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
