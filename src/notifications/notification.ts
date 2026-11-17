import {
  AndroidNotification,
  ApnsConfig,
  BaseMessage,
  TokenMessage,
  TopicMessage,
} from 'firebase-admin/lib/messaging/messaging-api'
import admin from '../firebase/firebase'
import { NotificationModel } from '../models/notifications.model'
import { UserDeviceModel } from '../models/userDevice.model'
import mongoose from 'mongoose'
import { LIVE_CONTENT_SUB, VOD_CONTENT_SUB } from '../models/content.subscribers.model'
import { SettingsModel } from '../models/userSettings.model'

export interface NotificationPayload {
  title: string
  body: string
  type: string
  metadata: Record<string, any>
  image?: string
}

export type NotificationAudience =
  | 'all'
  | 'new_services'
  | 'upcoming_events'
  | 'new_arrivals'
  | 'live_channels'

export type PushDeliveryResult = {
  targetedDevices: number
  sent: number
  failed: number
  removedInvalidTokens: number
}

type MakeUpcomingTopicPrefix = typeof VOD_CONTENT_SUB | typeof LIVE_CONTENT_SUB

export class Notification {
  static adminMainTopic = 'ADMIN_MAIN'

  static makeContentTopic = (id: string, prefix: MakeUpcomingTopicPrefix) =>
    `${prefix}_UPCOMING_${id}`

  static withUserTokens = (
    userId: string | mongoose.Types.ObjectId,
    callback: (token: string[]) => void | Promise<void>,
    maxTokens = 5,
  ) => {
    UserDeviceModel.find({ user_id: userId })
      .select('device_token')
      .sort({ _id: -1 })
      .limit(maxTokens)
      .then(documents => {
        callback(documents.map(document => document.device_token))
      })
      .catch(e => console.error('withUserTokens Error', e))
  }

  static subscribeToTopic = async (topic: string, tokens: string | string[]) => {
    try {
      await admin.messaging().subscribeToTopic(tokens, topic)
    } catch (e) {
      console.error('Firebase Admin Sub topic error', 'TOPIC: ', topic, 'ERROR ', e)
    }
  }

  static unsubscribeFromTopic = async (topic: string, tokens: string | string[]) => {
    try {
      await admin.messaging().unsubscribeFromTopic(tokens, topic)
    } catch (e) {
      console.error('Firebase Admin UNSub FROM topic error', 'TOPIC: ', topic, 'ERROR ', e)
    }
  }

  protected static _makeOSPushNotification = (
    payload: NotificationPayload,
  ): Pick<NotificationPayload, 'title' | 'body'> => ({
    title: payload.title,
    body: payload.body,
  })

  protected static _makeBaseFirebaseMessage = (payload: NotificationPayload): BaseMessage => {
    const OSNotification = this._makeOSPushNotification(payload)

    const data: BaseMessage['data'] = {
      title: payload.title,
      body: payload.body,
      type: payload.type,
      metadata: JSON.stringify(payload.metadata),
    }

    const androidNotification: AndroidNotification = {
      sound: 'default',
      ...OSNotification,
    }

    const apnConfiguration: ApnsConfig = {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },

      payload: {
        aps: {
          alert: OSNotification,
          sound: 'default',
          mutableContent: !!payload.image,
          // contentAvailable: true,
          // badge: 1,
        },
      },
    }

    if (typeof payload.image === 'string') {
      data.image = payload.image
      androidNotification.imageUrl = payload.image
      apnConfiguration.fcmOptions = {
        imageUrl: payload.image,
      }
    }

    return {
      data,
      android: {
        priority: 'high',
        notification: androidNotification,
      },

      apns: apnConfiguration,
    }
  }

  static sendTopicPushNotification = async (
    topic: string,
    payload: NotificationPayload,
    throwError = false,
  ) => {
    const message = this._makeBaseFirebaseMessage(payload)

    try {
      await admin.messaging().send({ ...message, topic })
    } catch (e) {
      console.log('sendTopicPushNotification error', e)
      if (throwError) {
        throw e
      }
    }
  }

  static sendTokenPushNotification = async (token: string, payload: NotificationPayload) => {
    const message = this._makeBaseFirebaseMessage(payload)

    // console.dir(message, { depth: null })

    try {
      await admin.messaging().send({ ...message, token })
    } catch (e) {
      console.log('sendTokenPushNotification error', e)
    }
  }

  static getEligibleDeviceTokens = async (audience: NotificationAudience = 'all') => {
    const settingsFilter: Record<string, unknown> = { allow_notifications: true }
    if (audience !== 'all') settingsFilter[audience] = true
    const userIds = await SettingsModel.distinct('user_id', settingsFilter)
    if (userIds.length === 0) return []
    return UserDeviceModel.distinct('device_token', { user_id: { $in: userIds } })
  }

  static sendPreferencePushNotification = async (
    audience: NotificationAudience,
    payload: NotificationPayload,
  ): Promise<PushDeliveryResult> => {
    const tokens = await this.getEligibleDeviceTokens(audience)
    if (tokens.length === 0) {
      return { targetedDevices: 0, sent: 0, failed: 0, removedInvalidTokens: 0 }
    }

    const invalidTokens: string[] = []
    let sent = 0
    let failed = 0
    const message = this._makeBaseFirebaseMessage(payload)

    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batchTokens = tokens.slice(offset, offset + 500)
      const response = await admin.messaging().sendEachForMulticast({
        ...message,
        tokens: batchTokens,
      })
      sent += response.successCount
      failed += response.failureCount
      response.responses.forEach((item, index) => {
        const code = item.error?.code
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(batchTokens[index])
        }
      })
    }

    if (invalidTokens.length > 0) {
      await UserDeviceModel.deleteMany({ device_token: { $in: invalidTokens } })
    }

    return {
      targetedDevices: tokens.length,
      sent,
      failed,
      removedInvalidTokens: invalidTokens.length,
    }
  }

  static createNotification = async (data: Record<string, any>) => {
    return new Promise(async resolve => {
      await new NotificationModel(data).save()
      resolve(true)
    })
  }
}
