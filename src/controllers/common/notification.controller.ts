import { Catch } from '../../utils/Catch'
import { sendResponse } from '../../utils/responder'
import { GetDefined } from '../../utils/GetDefined'
import { NotificationService } from '../../services/core/NotificationService'
import { AdminNotificationCenterService } from '../../services/core/AdminNotificationCenterService'

export class NotificationController {
  static getAdminInbox = Catch.async(async (req, res) => {
    sendResponse({
      res,
      data: await AdminNotificationCenterService.list(
        GetDefined.loggedInUser(req.user),
        req.query,
      ),
    })
  })

  static getAdminUnreadCount = Catch.async(async (req, res) => {
    sendResponse({
      res,
      data: {
        count: await AdminNotificationCenterService.unreadCount(
          GetDefined.loggedInUser(req.user),
        ),
      },
    })
  })

  static markAllAdminNotificationsSeen = Catch.async(async (req, res) => {
    await AdminNotificationCenterService.markAllSeen(GetDefined.loggedInUser(req.user))
    sendResponse({ res, message: 'Notifications marked as read' })
  })

  static getAdminNotificationSettings = Catch.async(async (_req, res) => {
    sendResponse({ res, data: await AdminNotificationCenterService.getSettings() })
  })

  static updateAdminNotificationSound = Catch.async(async (req, res) => {
    sendResponse({
      res,
      data: await AdminNotificationCenterService.updateSound(req.file),
      message: 'Notification sound updated',
    })
  })

  static getUnreadCount = Catch.async(async (req, res) => {
    sendResponse({
      res,
      data: {
        count: await NotificationService.getUnreadCount(GetDefined.loggedInUser(req.user)),
      },
    })
  })

  static createAdminNotification = Catch.async(async (req, res) => {
    await NotificationService.createAdminNotitication({
      currentUser: GetDefined.loggedInUser(req.user),
      title: req.body.title,
      description: req.body.description,
      photoFile: req.file,
    })

    sendResponse({
      res,
      message: 'Notification created successfully',
    })
  })

  static createClientNotification = Catch.async(async (req, res) => {
    await NotificationService.createClientNotification({
      currentUser: GetDefined.loggedInUser(req.user),
      title: req.body.title,
      description: req.body.description,
    })

    sendResponse({
      res,
      message: 'Notification created successfully',
    })
  })

  static getUnseenNotifications = Catch.async(async (req, res) => {
    const notifications = await NotificationService.getUnseenNotifications(
      GetDefined.loggedInUser(req.user),
      req.query,
    )

    sendResponse({
      res,
      data: notifications,
    })
  })

  static updateHasSeenNotification = Catch.async(async (req, res) => {
    await NotificationService.updateHasSeen({
      currentUser: GetDefined.loggedInUser(req.user),
      notificationId: req.body.notificationId,
      hasSeenStatus: req.body.hasSeenStatus,
    })

    sendResponse({
      res,
    })
  })

  static markAllNotificationsSeen = Catch.async(async (req, res) => {
    const updated = await NotificationService.markAllUserNotificationsSeen(
      GetDefined.loggedInUser(req.user),
    )
    sendResponse({
      res,
      data: { updated },
      message: 'All notifications marked as read',
    })
  })

  static deleteNotification = Catch.async(async (req, res) => {
    await NotificationService.deleteUserNotification(
      GetDefined.loggedInUser(req.user),
      req.params.notificationId,
    )
    sendResponse({ res, message: 'Notification deleted' })
  })

  static clearNotifications = Catch.async(async (req, res) => {
    const deleted = await NotificationService.clearUserNotifications(
      GetDefined.loggedInUser(req.user),
    )
    sendResponse({
      res,
      data: { deleted },
      message: 'Notifications cleared',
    })
  })
}
