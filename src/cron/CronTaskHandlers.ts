import { LiveModel } from '../models/lives.model'
import { VideoModel } from '../models/videos.model'
import { S3 } from '../services/aws/s3'
import { AutoFeaturedService } from '../services/core/AutoFeaturedService'
import { fetchUntranscodedVideoUploadDocumentsGenerator } from '../generators/fetchUntranscodedVideoUploads'
import { VideoUpload } from '../models/videoupload.model'
import { EpisodeModel } from '../models/episodes.model'
import { OperationalError } from '../utils/OperationalError'
import { AdModel } from '../models/admanager.model'
import { StringOrObjectId } from '../types'
import { SeasonModel } from '../models/seasons.model'
import {
  liveEvents10MReminderGenerator,
  liveEvents1hrReminderGenerator,
  liveEvents24hReminderGenerator,
} from '../generators/fetchUpcomingLiveEvents'
import { Notification } from '../notifications/notification'
import { formatTimeWithTimezone } from '../utils/date'
import { LiveViewerPresenceModel } from '../models/liveViewerPresence.model'
import { MediaConvert } from '../services/aws/mediaConvert'
import { AdManagerService } from '../services/core/AdmanagerService'
import { CampaignReportService } from '../services/core/CampaignReportService'
import { ContentLifecycleNotificationService } from '../services/core/ContentLifecycleNotificationService'

export class CronTaskHandlers {
  protected static checkTranscodedParentDocumentOrThrow = (
    parentDocument: unknown | null,
    documentId: StringOrObjectId,
  ) => {
    if (parentDocument == null) {
      throw new OperationalError(`Loose parent for video upload document with id: ${documentId}`, 404)
    }
  }

  protected static _updateTranscodedDocumentParent = async ({
    parentId,
    parentType,
    isTranscoded,
    _id: videoUploadDocumentId,
  }: VideoUpload) => {
    if (!isTranscoded) {
      throw new OperationalError('_updateTranscodedDocumentParent incorrectly called', 400)
    }

    switch (parentType) {
      case 'vod':
        const readyVideo = await VideoModel.findByIdAndUpdate(parentId, {
            isVideoReady: true,
          }, { new: true })
        this.checkTranscodedParentDocumentOrThrow(readyVideo, videoUploadDocumentId)

        if (
          readyVideo &&
          (!readyVideo.releaseDate || readyVideo.releaseDate.getTime() <= Date.now())
        ) {
          await ContentLifecycleNotificationService.publish({
            eventKey: `vod:${readyVideo._id}:new-arrival`,
            title: 'New arrival',
            description: `${readyVideo.title} is now available`,
            category: 'new_arrivals',
            route: '/uploads',
            type: 'NEW_ARRIVAL',
            audience: 'new_arrivals',
            metadata: { contentId: readyVideo._id.toString(), contentType: 'vod' },
            photo: readyVideo.landscapePhoto,
          })
        }

        break

      case 'vod-trailer':
        this.checkTranscodedParentDocumentOrThrow(
          await VideoModel.findByIdAndUpdate(parentId, {
            isTrailerReady: true,
          }),
          videoUploadDocumentId,
        )

        break

      case 'episode':
        const readyEpisode = await EpisodeModel.findByIdAndUpdate(parentId, {
            isVideoReady: true,
          }, { new: true })
        this.checkTranscodedParentDocumentOrThrow(readyEpisode, videoUploadDocumentId)
        if (readyEpisode) {
          await ContentLifecycleNotificationService.publish({
            eventKey: `episode:${readyEpisode._id}:new-arrival`,
            title: 'New episode available',
            description: `${readyEpisode.title} is ready to watch`,
            category: 'new_arrivals',
            route: '/uploads',
            type: 'NEW_ARRIVAL',
            audience: 'new_arrivals',
            metadata: { contentId: readyEpisode._id.toString(), contentType: 'episode' },
          })
        }

        break

      case 'episode-trailer':
        this.checkTranscodedParentDocumentOrThrow(
          await EpisodeModel.findByIdAndUpdate(parentId, {
            isTrailerReady: true,
          }),
          videoUploadDocumentId,
        )
        break

      case 'season-trailer':
        this.checkTranscodedParentDocumentOrThrow(
          await SeasonModel.findByIdAndUpdate(parentId, { isTrailerReady: true }),
          videoUploadDocumentId,
        )

        break

      case 'live':
        this.checkTranscodedParentDocumentOrThrow(
          await LiveModel.findByIdAndUpdate(parentId, { isPreviewVideoReady: true }),
          videoUploadDocumentId,
        )
        break

      case 'ad':
        this.checkTranscodedParentDocumentOrThrow(
          await AdModel.findByIdAndUpdate(parentId, { isVideoReady: true }),
          videoUploadDocumentId,
        )

        break

      case 'subtitle':
        console.error('Transcode subtitle parent encountred')
        break

      default:
        break
    }
  }

  static updateVideoUploadDoc = async (document: VideoUpload) => {
    try {
      if (!document.hlsKey) {
        return
      }

      document.isTranscoded = await S3.objectExists(document.hlsKey)

      if (!document.isTranscoded) {
        if (document.hlsJobId) {
          const job = await MediaConvert.getJob(document.hlsJobId)
          if (job?.Status === 'ERROR' || job?.Status === 'CANCELED') {
            document.hlsStatus = 'failed'
            document.hlsError = job.ErrorMessage ?? `MediaConvert job ${job.Status.toLowerCase()}`
            await document.save()
          }
        }
        return
      }

      document.hlsStatus = 'ready'
      document.hlsError = null
      await this._updateTranscodedDocumentParent(document)
      await document.save()
    } catch (error: any) {
      console.error(
        'Error updating isTranscoded for video upload document',
        document._id,
        error?.message ?? error,
      )
    }
  }

  static updateVidUploadsResolutions = async () => {
    for await (const videoUploadDouments of fetchUntranscodedVideoUploadDocumentsGenerator()) {
      await Promise.all(videoUploadDouments.map(this.updateVideoUploadDoc))
    }
  }

  static expireFeaturedContents = async () => {
    try {
      const dateNow = new Date()

      const filter = {
        featured: true,
        $and: [
          {
            feat_expiry: { $exists: true },
          },
          {
            feat_expiry: { $lte: dateNow },
          },
        ],
      }

      const expiryUpdate = {
        $set: { featured: false },
        $unset: { feat_expiry: 1, featuredSource: 1, featuredAt: 1, featuredScore: 1 },
      }
      await LiveModel.updateMany(filter, expiryUpdate)
      await VideoModel.updateMany(filter, expiryUpdate)
      await AutoFeaturedService.refreshIfDue()
    } catch (error: any) {
      console.log('Cron Error: expire featured content', error.message ?? error)
    }
  }

  static expireLiveEvents = async () => {
    const now = new Date()
    await LiveModel.updateMany(
      { expiry: { $lte: now }, $or: [{ expired: false }, { active: true }] },
      { $set: { expired: true, active: false, active_views: 0, endedAt: now } },
    )
    await LiveViewerPresenceModel.deleteMany({ updatedAt: { $lte: new Date(now.getTime() - 86400000) } })
  }

  static deleteExpiredAds = async () => {
    try {
      await AdManagerService.deleteExpiredAds()
    } catch (error: any) {
      console.error('Cron Error: delete expired ads', error.message ?? error)
    }
  }

  static sendDueCampaignReports = async () => {
    try {
      await CampaignReportService.processDueReports()
    } catch (error: any) {
      console.error('Cron Error: campaign reports', error.message ?? error)
    }
  }

  static handleOneHourLiveEventPushReminder = async () => {
    console.log('handleOneHourLiveEventPushReminder started')

    const batchGenerator = liveEvents1hrReminderGenerator({
      batchSize: 20,
    })

    for await (const liveDocuments of batchGenerator) {
      await Promise.all(liveDocuments.map(async liveDocument => {
        const liveId = liveDocument._id.toString()
        try {
          await Notification.sendTopicPushNotification(Notification.makeContentTopic(liveId, 'LIVE'), {
            title: 'Countdown',
            type: 'LIVE_EVENT_REMINDER',
            body: `1 hour to showtime! ${liveDocument.title} starts soon`,
            image: liveDocument.coverPhoto,
            metadata: { liveId },
          }, true)

          await LiveModel.findByIdAndUpdate(liveId, {
            $set: {
              reminder1hSentAt: new Date(),
            },
          })
        } catch (err: any) {
          console.error('handleOneHourLiveEventPushReminder error', err)

          await LiveModel.findByIdAndUpdate(liveId, {
            $inc: { reminder1hAttemptCount: 1 },
            $set: {
              reminder1hLastError: err.message ?? 'handleOneHourLiveEventPushReminder error',
            },
          })
        }
      }))
    }
  }

  static handle24HourLiveEventPushReminder = async () => {
    console.log('handle24HourLiveEventPushReminder started')

    const batchGenerator = liveEvents24hReminderGenerator({
      batchSize: 20,
    })

    for await (const liveDocuments of batchGenerator) {
      await Promise.all(liveDocuments.map(async liveDocument => {
        const liveId = liveDocument._id.toString()
        try {
          const message = `Are you set? Tomorrow ${liveDocument.title} goes LIVE by ${formatTimeWithTimezone(liveDocument.start)} on Reeplay`

          await Notification.sendTopicPushNotification(Notification.makeContentTopic(liveId, 'LIVE'), {
            title: 'Countdown',
            type: 'LIVE_EVENT_REMINDER',
            body: message,
            image: liveDocument.coverPhoto,
            metadata: { liveId },
          }, true)

          await LiveModel.findByIdAndUpdate(liveId, {
            $set: {
              reminder24hSentAt: new Date(),
            },
          })
        } catch (err: any) {
          console.error('handle24HourLiveEventPushReminder error', err)

          await LiveModel.findByIdAndUpdate(liveId, {
            $inc: { reminder24hAttemptCount: 1 },
            $set: {
              reminder24hLastError: err.message ?? 'handle24HourLiveEventPushReminder error',
            },
          })
        }
      }))
    }
  }
  static handle10MinutesLiveEventPushReminder = async () => {
    console.log('handle10MinutesLiveEventPushReminder started')

    const batchGenerator = liveEvents10MReminderGenerator({
      batchSize: 20,
    })

    for await (const liveDocuments of batchGenerator) {
      await Promise.all(liveDocuments.map(async liveDocument => {
        const liveId = liveDocument._id.toString()

        try {
          await Notification.sendTopicPushNotification(Notification.makeContentTopic(liveId, 'LIVE'), {
            title: 'Countdown',
            type: 'LIVE_EVENT_REMINDER',
            body: `${liveDocument.title} starts in 10 mins. Ready?`,
            image: liveDocument.coverPhoto,
            metadata: { liveId },
          }, true)

          await LiveModel.findByIdAndUpdate(liveId, {
            $set: {
              reminder10mSentAt: new Date(),
            },
          })
        } catch (err: any) {
          console.error('handle10MinutesLiveEventPushReminder error', err)

          await LiveModel.findByIdAndUpdate(liveId, {
            $inc: { reminder10MinutesAttemptCount: 1 },
            $set: {
              reminder10MinutesError: err.message ?? 'handle10MinutesLiveEventPushReminder error',
            },
          })
        }
      }))
    }
  }
}
