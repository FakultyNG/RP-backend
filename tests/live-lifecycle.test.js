jest.mock('../build/src/env', () => ({
  __esModule: true,
  default: { CDN_IMAGES_BASE_URL: 'https://images.example.test' },
}))

jest.mock('../build/src/models/lives.model', () => ({
  LiveModel: {
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}))

jest.mock('../build/src/notifications/notification', () => ({
  Notification: {
    makeContentTopic: jest.fn(() => 'live-topic'),
    sendTopicPushNotification: jest.fn(),
  },
}))

const { LiveModel } = require('../build/src/models/lives.model')
const { Notification } = require('../build/src/notifications/notification')
const {
  handleRTMPStreamPublish,
  handleRTMPStreamPublishDone,
} = require('../build/src/utils/live')

const streamDocument = overrides => ({
  _id: 'live-1',
  title: 'Launch show',
  start: new Date(Date.now() - 60_000),
  expiry: new Date(Date.now() + 60 * 60_000),
  coverPhoto: { Key: 'cover.webp' },
  ...overrides,
})

const mockStreamLookup = document => {
  LiveModel.findOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(document),
  })
}

describe('live publishing lifecycle', () => {
  beforeEach(() => jest.clearAllMocks())

  test('activates the event and sends a notification when nginx accepts a publish', async () => {
    mockStreamLookup(streamDocument())
    LiveModel.findByIdAndUpdate.mockResolvedValue({ _id: 'live-1' })

    await handleRTMPStreamPublish('stream-key')

    expect(LiveModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'live-1',
      expect.objectContaining({
        $set: expect.objectContaining({ active: true, expired: false, upcoming: false }),
      }),
    )
    expect(Notification.sendTopicPushNotification).toHaveBeenCalledTimes(1)
  })

  test('rejects a publisher more than 15 minutes before the scheduled start', async () => {
    mockStreamLookup(streamDocument({ start: new Date(Date.now() + 16 * 60_000) }))

    await expect(handleRTMPStreamPublish('stream-key')).rejects.toMatchObject({ statusCode: 400 })
    expect(LiveModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  test('marks a stream inactive when nginx reports publish done', async () => {
    LiveModel.findOneAndUpdate.mockResolvedValue({ _id: 'live-1' })

    await handleRTMPStreamPublishDone('stream-key')

    expect(LiveModel.findOneAndUpdate).toHaveBeenCalledWith(
      { stream_key: 'stream-key' },
      expect.any(Array),
      { new: true },
    )
  })
})
