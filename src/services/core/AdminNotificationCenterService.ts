import { ExpressRequestQuery, QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import { LoggedInUser, MulterFile } from '../../types'
import { AdminInboxNotificationModel, adminNotificationCategories } from '../../models/adminInboxNotification.model'
import { AdminNotificationSettingsModel } from '../../models/adminNotificationSettings.model'
import { MediaAccess } from '../media-access'
import { MediaManagement } from '../media-management'
import { OperationalError } from '../../utils/OperationalError'
import { SuggestionModel } from '../../models/suggestions.model'

export type AdminNotificationCategory = (typeof adminNotificationCategories)[number]

type PublishAdminNotification = {
  eventKey: string
  title: string
  description?: string
  category: AdminNotificationCategory
  route?: string
  metadata?: Record<string, unknown>
}

export class AdminNotificationCenterService {
  protected static syncUnreadSuggestions = async () => {
    const suggestions = await SuggestionModel.find({ seen: false })
      .select('_id message')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
    await Promise.all(
      suggestions.map(suggestion =>
        this.publish({
          eventKey: `suggestion:${suggestion._id}`,
          title: 'New customer suggestion',
          description: suggestion.message,
          category: 'suggestions',
          route: '/suggestions',
          metadata: { suggestionId: suggestion._id.toString() },
        }),
      ),
    )
  }

  static publish = (data: PublishAdminNotification) =>
    AdminInboxNotificationModel.findOneAndUpdate(
      { eventKey: data.eventKey },
      { $setOnInsert: data },
      { upsert: true, new: true },
    )

  static list = async (currentUser: LoggedInUser, query: ExpressRequestQuery) => {
    await this.syncUnreadSuggestions()
    const { skip, limit } = QueryParamsFeatures.paginagteParams(query)
    const category = typeof query.category === 'string' ? query.category : undefined
    const filter = category && adminNotificationCategories.includes(category as any)
      ? { category }
      : {}
    const notifications = await AdminInboxNotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()

    return notifications.map(notification => ({
      ...notification,
      hasSeen: notification.seenBy.some(id => id.toString() === currentUser._id.toString()),
      seenBy: undefined,
    }))
  }

  static unreadCount = async (currentUser: LoggedInUser) => {
    await this.syncUnreadSuggestions()
    return AdminInboxNotificationModel.countDocuments({ seenBy: { $ne: currentUser._id } })
  }

  static markAllSeen = (currentUser: LoggedInUser) =>
    AdminInboxNotificationModel.updateMany(
      { seenBy: { $ne: currentUser._id } },
      { $addToSet: { seenBy: currentUser._id } },
    )

  static getSettings = async () => {
    const settings = await AdminNotificationSettingsModel.findOne({ key: 'global' }).lean()
    return {
      soundName: settings?.soundName ?? null,
      soundUrl: settings?.sound?.Key
        ? MediaAccess.getImageAndSubtitleURL(settings.sound.Key)
        : null,
    }
  }

  static updateSound = async (file?: MulterFile) => {
    if (!file || !file.mimetype.startsWith('audio/')) {
      throw new OperationalError('Choose a valid audio file', 400)
    }

    const previous = await AdminNotificationSettingsModel.findOne({ key: 'global' })
    const upload = await MediaManagement.storeNotificationSound(file)
    await AdminNotificationSettingsModel.findOneAndUpdate(
      { key: 'global' },
      {
        $set: {
          sound: { Bucket: upload.Bucket, Key: upload.Key },
          soundName: file.originalname,
        },
      },
      { upsert: true, new: true },
    )

    if (previous?.sound?.Key && previous.sound.Bucket) {
      void MediaManagement.deleteObject(previous.sound.Key, previous.sound.Bucket)
    }
    return this.getSettings()
  }
}
