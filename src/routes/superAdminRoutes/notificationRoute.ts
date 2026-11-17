import { Router } from 'express'
import { Multer } from '../../utils/Multer'
import { NotificationController } from '../../controllers/common/notification.controller'

export const superAdminNotificationRouter = Router()

superAdminNotificationRouter.get('/inbox', NotificationController.getAdminInbox)
superAdminNotificationRouter.get('/unread-count', NotificationController.getAdminUnreadCount)
superAdminNotificationRouter.put('/mark-all-read', NotificationController.markAllAdminNotificationsSeen)
superAdminNotificationRouter.get('/settings', NotificationController.getAdminNotificationSettings)
superAdminNotificationRouter.put(
  '/settings/sound',
  Multer.uploadSingleNotificationSound,
  NotificationController.updateAdminNotificationSound,
)

superAdminNotificationRouter.post(
  '/create',
  Multer.uploadSingleImage,
  NotificationController.createAdminNotification,
)
