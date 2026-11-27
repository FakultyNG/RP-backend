jest.mock('../build/src/env', () => ({
  __esModule: true,
  default: {CDN_IMAGES_BASE_URL: 'https://images.example.test'},
}))

jest.mock('../build/src/notifications/notification', () => ({
  Notification: {},
  NotificationAudience: {},
}))

jest.mock('../build/src/models/customer.notification.model', () => ({
  UserNotificationModel: {
    updateMany: jest.fn(),
    findOneAndDelete: jest.fn(),
    deleteMany: jest.fn(),
  },
}))

const {UserNotificationModel} = require('../build/src/models/customer.notification.model')
const {NotificationService} = require('../build/src/services/core/NotificationService')

describe('customer notification actions', () => {
  const user = {_id: '507f1f77bcf86cd799439011'}

  beforeEach(() => jest.clearAllMocks())

  test('marks only the current user unread notifications as read', async () => {
    UserNotificationModel.updateMany.mockResolvedValue({modifiedCount: 3})

    await expect(NotificationService.markAllUserNotificationsSeen(user)).resolves.toBe(3)
    expect(UserNotificationModel.updateMany).toHaveBeenCalledWith(
      {user: user._id, hasSeen: false},
      {$set: {hasSeen: true}},
    )
  })

  test('deletes one notification only when it belongs to the current user', async () => {
    const notificationId = '507f191e810c19729de860ea'
    UserNotificationModel.findOneAndDelete.mockResolvedValue({_id: notificationId})

    await NotificationService.deleteUserNotification(user, notificationId)
    expect(UserNotificationModel.findOneAndDelete).toHaveBeenCalledWith({
      _id: notificationId,
      user: user._id,
    })
  })

  test('clears only the current user notifications', async () => {
    UserNotificationModel.deleteMany.mockResolvedValue({deletedCount: 4})

    await expect(NotificationService.clearUserNotifications(user)).resolves.toBe(4)
    expect(UserNotificationModel.deleteMany).toHaveBeenCalledWith({user: user._id})
  })

  test('rejects malformed notification ids without querying the database', async () => {
    await expect(NotificationService.deleteUserNotification(user, 'not-an-id'))
      .rejects.toMatchObject({statusCode: 404})
    expect(UserNotificationModel.findOneAndDelete).not.toHaveBeenCalled()
  })
})
