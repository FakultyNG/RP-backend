import { Router } from 'express'
import { NotificationController } from '../../controllers/common/notification.controller'

export const notificationRouter = Router()

notificationRouter.get('/unread-count', NotificationController.getUnreadCount)
notificationRouter.put('/mark-all-read', NotificationController.markAllNotificationsSeen)
notificationRouter.delete('/clear', NotificationController.clearNotifications)
notificationRouter.delete('/:notificationId', NotificationController.deleteNotification)

notificationRouter
  .route('/')
  .get(NotificationController.getUnseenNotifications)
  .put(NotificationController.updateHasSeenNotification)
