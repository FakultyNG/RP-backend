import { SubtitleModel } from '../models/subtitle.model'
import { Video } from '../models/videos.model'
import { VideoUploadModel } from '../models/videoupload.model'
import { S3 } from '../services/aws/s3'
import { SeasonModel } from '../models/seasons.model'
import { EpisodeModel } from '../models/episodes.model'
import { Live } from '../models/lives.model'
import { PaymentModel } from '../models/payments.model'
import { MongoDBObjectId } from '../types/general'
import { StringOrObjectId } from '../types'
import { MediaConvert } from '../services/aws/mediaConvert'

export class Purge {
  static live = async (live: Live) => {
    const payments: MongoDBObjectId[] = []

    await Promise.allSettled([
      Purge.subtitlesByParentId(live._id),
      live.previewVideoUpload ? Purge.videoUploadById(live.previewVideoUpload) : Promise.resolve(),
    ])
    // live.payment_id && payments.push(live.payment_id)
    // live.extpayment_id && payments.push(live.extpayment_id)

    payments.forEach(async payment => {
      try {
        await PaymentModel.findByIdAndDelete(payment)
      } catch (e) {
        console.error(`Error deleting paymentId: ${payment} for deleted live ${live._id}`)
      }
    })
  }

  private static cancelActiveTranscode = async (jobId?: string | null) => {
    if (!jobId) return

    try {
      const job = await MediaConvert.getJob(jobId)
      if (job?.Status === 'SUBMITTED' || job?.Status === 'PROGRESSING') {
        await MediaConvert.cancelJob(jobId)
      }
    } catch (error: any) {
      const isMissing =
        error?.name === 'NotFoundException' || error?.$metadata?.httpStatusCode === 404
      if (!isMissing) throw error
    }
  }

  private static directoryPrefix = (key?: string | null) => {
    if (!key?.includes('/')) return null
    return key.slice(0, key.lastIndexOf('/') + 1)
  }

  static videoUploadById = async (vidUploadId: StringOrObjectId) => {
    const vidUpload = await VideoUploadModel.findById(vidUploadId)
    if (vidUpload == null) return

    // Stop an active job first so MediaConvert cannot recreate output after cleanup.
    await this.cancelActiveTranscode(vidUpload.hlsJobId)

    const prefixes = new Set<string>([
      `transcode/${vidUpload.key}`,
      `${MediaConvert.getHlsPrefix(vidUpload.key)}/`,
    ])
    const hlsDirectory = this.directoryPrefix(vidUpload.hlsKey)
    if (hlsDirectory) prefixes.add(hlsDirectory)

    const prefixedKeys = (
      await Promise.all([...prefixes].map(prefix => S3.listKeys(prefix, vidUpload.bucket)))
    ).flat()

    const keys = new Set<string>([
      vidUpload.key,
      ...vidUpload.resolutions.map(resolution => resolution.key),
      ...prefixedKeys,
    ])
    if (vidUpload.hlsKey) keys.add(vidUpload.hlsKey)

    await S3.deleteObjects([...keys], vidUpload.bucket)
    await VideoUploadModel.findByIdAndDelete(vidUploadId)
  }

  // static posterById = async (posterId: MongoDBObjectId) => {
  //   try {
  //     const poster = await PosterImageModel.findByIdAndDelete(posterId)
  //     poster && (await S3.deleteObject(poster.key, poster.bucket))
  //   } catch (e) {
  //     console.error('Error deleting poster with Id:', posterId)
  //   }
  // }

  // static postersByParentId = async (parentId: MongoDBObjectId) => {
  //   try {
  //     const posters = await PosterImageModel.find({ video_id: parentId })

  //     await Promise.all(
  //       posters.map(async ({ key, bucket }) => {
  //         try {
  //           await S3.deleteObject(key, bucket)
  //           await PosterImageModel.findOneAndDelete({ video_id: parentId })
  //         } catch (e) {
  //           console.error(
  //             `Error deleting poster with Key: ${key} => bucket: ${bucket} on VOD delete`,
  //           )
  //         }
  //       }),
  //     )
  //   } catch (e) {
  //     console.error('Error deleting poster with video_id:', parentId)
  //   }
  // }

  static subtitlesByParentId = async (parentId: MongoDBObjectId) => {
    const subtitles = await SubtitleModel.find({ video_id: parentId })

    await Promise.all(
      subtitles.map(async subtitle => {
        await S3.deleteObject(subtitle.key, subtitle.bucket)
        await SubtitleModel.findByIdAndDelete(subtitle._id)
      }),
    )
  }

  static seasonsByVideoId = async (vodId: MongoDBObjectId) => {
    const seasons = await SeasonModel.find({ video: vodId })

    await Promise.all(
      seasons.map(async season => {
        const episodes = await EpisodeModel.find({ season: season._id })

        await Promise.all(
          episodes.map(async episode => {
            await Promise.all([
              episode.videoUpload ? this.videoUploadById(episode.videoUpload) : Promise.resolve(),
              episode.trailerUpload
                ? this.videoUploadById(episode.trailerUpload)
                : Promise.resolve(),
              this.subtitlesByParentId(episode._id),
            ])
            await EpisodeModel.findByIdAndDelete(episode._id)
          }),
        )

        await SeasonModel.findByIdAndDelete(season._id)
      }),
    )
  }

  static vod = async (videoDocument: Video) => {
    await Promise.all([
      this.subtitlesByParentId(videoDocument._id),
      videoDocument.videoUpload
        ? this.videoUploadById(videoDocument.videoUpload)
        : Promise.resolve(),
      videoDocument.trailerUpload
        ? this.videoUploadById(videoDocument.trailerUpload)
        : Promise.resolve(),
    ])

    if (videoDocument.type === 'series') {
      await this.seasonsByVideoId(videoDocument._id)
    }

    await Promise.all([
      S3.deleteObject(videoDocument.portraitPhoto.Key, videoDocument.portraitPhoto.Bucket),
      S3.deleteObject(videoDocument.landscapePhoto.Key, videoDocument.landscapePhoto.Bucket),
    ])
  }
}
