import { MediaAccess } from '../../../src/services/media-access'
import { NotificationModel } from '../../models/notifications.model'
import { LoggedInUser, MulterFile } from '../../types'
import { OperationalError } from '../../utils/OperationalError'
import { PushNotificationService } from './PushNotificationService'
import { AdminNotificationModel } from '../../models/admin.notification.model'
import { MediaManagement } from '../media-management'
import { fetchManyUsersByFilterGenerator, Filter } from '../../generators/fetchAllExceptUserId'
import { UserNotificationModel } from '../../models/customer.notification.model'
import { ExpressRequestQuery, QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import { NotificationRepo } from '../../repositories/NotificationRepo'
import { SettingsModel } from '../../models/userSettings.model'
import { Notification, NotificationAudience } from '../../notifications/notification'
import { PlatformSettingsService } from './PlatformSettingsService'

interface GetNotificationsInput {
  currentUser: LoggedInUser
  page: number
  limit: number
}

interface UpdateHasSeenParams {
  currentUser: LoggedInUser
  notificationId: string
  hasSeenStatus: boolean
}

interface CreateClientNotification {
  currentUser: LoggedInUser
  title: string
  description: string
}

interface CreateAdminNotification extends CreateClientNotification {
  photoFile?: MulterFile
}

interface CreateStoredAdminNotification extends CreateClientNotification {
  type?: string
  metadata?: Record<string, unknown>
  photo?: {
    Bucket: string
    Key: string
  }
}

interface CreateAutomatedNotification {
  eventKey: string
  title: string
  description: string
  type: string
  audience: NotificationAudience
  metadata?: Record<string, unknown>
  photo?: { Bucket: string; Key: string }
}

export class NotificationService {
  static getUnreadCount = async (currentUser: LoggedInUser) =>
    NotificationRepo.countUnreadUserNotifications(
      currentUser._id,
      (await PlatformSettingsService.getLiveAccess()).enabled,
    )

  static createStoredAdminNotification = async ({
    currentUser,
    title,
    description,
    type,
    metadata,
    photo,
  }: CreateStoredAdminNotification) => {
    const adminNotification = await AdminNotificationModel.create({
      admin: currentUser._id,
      title,
      description,
      type,
      metadata,
      photo,
    })

    const filter: Filter = {
      _id: { $ne: currentUser._id },
      role: 'customer',
    }

    for await (const users of fetchManyUsersByFilterGenerator(filter)) {
      await Promise.all(
        users.map(user =>
          UserNotificationModel.create({
            adminNotification: adminNotification._id,
            user: user._id,
            publisher: 'Admin',
          }),
        ),
      )
    }

    return adminNotification
  }

  static createAutomatedNotification = async ({
    eventKey,
    title,
    description,
    type,
    audience,
    metadata = {},
    photo,
  }: CreateAutomatedNotification) => {
    if (audience === 'live_channels' && !(await PlatformSettingsService.getLiveAccess()).enabled) {
      return false
    }
    if (await AdminNotificationModel.exists({ eventKey })) return false

    let notification
    try {
      notification = await AdminNotificationModel.create({
        eventKey,
        title,
        description,
        type,
        metadata,
        photo,
      })
    } catch (error: any) {
      if (error?.code === 11000) return false
      throw error
    }

    const settingsFilter: Record<string, unknown> = { allow_notifications: true }
    if (audience !== 'all') settingsFilter[audience] = true
    const userIds = await SettingsModel.distinct('user_id', settingsFilter)
    if (userIds.length > 0) {
      await UserNotificationModel.insertMany(
        userIds.map(user => ({
          adminNotification: notification._id,
          user,
          publisher: 'Admin',
        })),
        { ordered: false },
      )
    }

    await Notification.sendPreferencePushNotification(audience, {
      title,
      body: description,
      type,
      metadata,
      image: photo?.Key ? MediaAccess.getImageAndSubtitleURL(photo.Key) : undefined,
    })
    return true
  }

  static createClientNotification = async ({
    currentUser,
    title,
    description,
  }: CreateClientNotification) => {
    const adminNotification = await AdminNotificationModel.create({
      admin: currentUser._id,
      title,
      description,
      photo: currentUser.photo,
    })

    setTimeout(async () => {
      const filter: Filter = {
        role: 'customer',
      }

      for await (const users of fetchManyUsersByFilterGenerator(filter)) {
        users.forEach(async user => {
          try {
            await UserNotificationModel.create({
              adminNotification: adminNotification._id,
              user: user._id,
              publisher: 'Client',
            })
          } catch (e) {
            console.error('Error creating Customer notification for ')
          }
        })
      }
    }, 0)
  }

  static createAdminNotitication = async ({
    currentUser,
    title,
    description,
    photoFile,
  }: CreateAdminNotification) => {
    if (photoFile == null) {
      throw new OperationalError('photo file is required', 400)
    }

    const photoUpload = await MediaManagement.storeImageAndSubtitle(photoFile)

    if (photoUpload.Key == null || photoUpload.Bucket == null) {
      throw new OperationalError('error processing photo upload', 500)
    }

    const photoSchema = {
      Bucket: photoUpload.Bucket,
      Key: photoUpload.Key,
    }

    return this.createStoredAdminNotification({
      currentUser,
      title,
      description,
      photo: photoSchema,
    })
  }

  static getUnseenNotifications = async (currentUser: LoggedInUser, query: ExpressRequestQuery) => {
    const { skip, limit } = QueryParamsFeatures.paginagteParams(query)

    const notifications = await NotificationRepo.fetchUserNotifications({
      userId: currentUser._id,
      skip,
      limit,
      includeLive: (await PlatformSettingsService.getLiveAccess()).enabled,
    })

    return notifications.map(notification => {
      const result = Object.assign(notification, {
        photoUri:
          notification.adminNotification.photo == null
            ? null
            : MediaAccess.getImageAndSubtitleURL(notification.adminNotification.photo.Key),
      })

      return result
    })
  }

  static updateHasSeen = async ({
    currentUser,
    notificationId,
    hasSeenStatus,
  }: UpdateHasSeenParams) => {
    const notification = await UserNotificationModel.findOneAndUpdate(
      { _id: notificationId, user: currentUser._id },
      { $set: { hasSeen: hasSeenStatus } },
    )

    if (notification == null) {
      throw new OperationalError('Notfication not found', 404)
    }
  }

  // OLD
  static Push = PushNotificationService

  static getNotifications = async (params: GetNotificationsInput) => {
    const notifications = await NotificationModel.aggregate([
      {
        $match: {
          user_id: params.currentUser._id,
        },
      },
      {
        $lookup: {
          from: 'videos',
          localField: 'content_id',
          foreignField: '_id',
          as: 'content',
        },
      },
      {
        $project: {
          type: 1,
          title: 1,
          categories: 1,
          thumbnail: 1,
          createdAt: 1,
          content: { $first: '$content' },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $skip: (params.page - 1) * params.limit,
      },
      {
        $limit: params.limit,
      },
    ])

    // Get signed URLs for thumbnails
    const notificationsWithUrls = notifications.map(async notification => {
      return {
        ...notification,
        thumbnail_url: await MediaAccess.getImageAndSubtitleURL(notification.thumbnail.Key),
      }
    })

    return notificationsWithUrls
  }

  static markUserNotificationSeen = async (currentUser: LoggedInUser, notificationId: string) => {
    const seenNotification = await NotificationModel.findOneAndUpdate(
      { _id: notificationId, user_id: currentUser.id },
      { seen: true },
    )

    if (seenNotification === null) {
      throw new OperationalError('Invalid notificationId', 404)
    }
  }
}
