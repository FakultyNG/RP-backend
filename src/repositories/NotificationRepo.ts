import { Aggregate } from 'mongoose'
import { MongoDBObjectId } from '../types/general'
import { AdminNotificationSchema } from '../models/admin.notification.model'
import {
  UserNotificationSchema,
  UserNotificationModel,
} from '../models/customer.notification.model'

interface UserNotification extends Omit<UserNotificationSchema, 'adminNotification'> {
  adminNotification: AdminNotificationSchema & { _id: MongoDBObjectId }
}

interface FetchUserNotificationsParams {
  userId: MongoDBObjectId
  skip: number
  limit: number
  includeLive?: boolean
}

export class NotificationRepo {
  static countUnreadUserNotifications = async (userId: MongoDBObjectId, includeLive = true) => {
    if (includeLive) {
      return UserNotificationModel.countDocuments({ user: userId, hasSeen: false })
    }

    const [result] = await UserNotificationModel.aggregate<{ total: number }>([
      { $match: { user: userId, hasSeen: false } },
      {
        $lookup: {
          from: 'admin-notifications',
          localField: 'adminNotification',
          foreignField: '_id',
          as: 'adminNotification',
        },
      },
      { $set: { adminNotification: { $first: '$adminNotification' } } },
      {
        $match: {
          'adminNotification.type': { $ne: 'LIVE_EVENT_REMINDER' },
          'adminNotification.metadata.contentType': { $ne: 'live' },
        },
      },
      { $count: 'total' },
    ])
    return result?.total ?? 0
  }

  static fetchUserNotifications = ({
    userId,
    skip,
    limit,
    includeLive = true,
  }: FetchUserNotificationsParams) => {
    const res = UserNotificationModel.aggregate([
      { $match: { user: userId } },

      {
        $lookup: {
          from: 'admin-notifications',
          localField: 'adminNotification',
          foreignField: '_id',
          as: 'adminNotification',
        },
      },

      { $match: { 'adminNotification.0': { $exists: true } } },
      { $set: { adminNotification: { $first: '$adminNotification' } } },
      ...(includeLive
        ? []
        : [
            {
              $match: {
                'adminNotification.type': { $ne: 'LIVE_EVENT_REMINDER' },
                'adminNotification.metadata.contentType': { $ne: 'live' },
              },
            },
          ]),
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ])

    return res as Aggregate<UserNotification[]>
  }
}
