import mongoose from 'mongoose'

import { AdModel } from '../models/admanager.model'
import { VideoUploadModel } from '../models/videoupload.model'
import { AwsUtils } from '../services/aws/utils'
import { S3 } from '../services/aws/s3'
import { connectMongoDB } from '../utils/connectDB'

type CleanupSummary = {
  applied: boolean
  legacyMp4Objects: number
  welcomeCampaigns: number
  welcomeVideoUploads: number
  welcomeVideoObjects: number
  clearedLegacyResolutionDocuments: number
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

export const cleanupLegacyMp4AndWelcomeAds = async (apply = false): Promise<CleanupSummary> => {
  const legacyMp4Keys = (await S3.listKeys('transcode/')).filter(key =>
    key.toLowerCase().endsWith('.mp4'),
  )

  const welcomeCampaigns = await AdModel.find({ type: 'mobile' })
    .select({ _id: 1, videoUpload: 1 })
    .lean()
  const welcomeUploadIds = unique(
    welcomeCampaigns.map(ad => ad.videoUpload?.toString() ?? ''),
  )
  const welcomeUploads = await VideoUploadModel.find({ _id: { $in: welcomeUploadIds } }).lean()

  const welcomeOutputKeyGroups = await Promise.all(
    welcomeUploads.map(async upload => {
      const [legacyOutputs, hlsOutputs] = await Promise.all([
        S3.listKeys(`transcode/${upload.key}`),
        S3.listKeys(`railway-hls/${upload.key}/`),
      ])
      return [
        upload.key,
        ...upload.resolutions.map(resolution => resolution.key),
        ...legacyOutputs,
        ...hlsOutputs,
      ]
    }),
  )
  const welcomeVideoKeys = unique(welcomeOutputKeyGroups.flat())

  const summary: CleanupSummary = {
    applied: apply,
    legacyMp4Objects: legacyMp4Keys.length,
    welcomeCampaigns: welcomeCampaigns.length,
    welcomeVideoUploads: welcomeUploads.length,
    welcomeVideoObjects: welcomeVideoKeys.length,
    clearedLegacyResolutionDocuments: 0,
  }

  if (!apply) return summary
  if (process.env.ALLOW_MEDIA_PURGE !== 'true') {
    throw new Error('Refusing cleanup without ALLOW_MEDIA_PURGE=true')
  }

  const [campaignResult, resolutionResult] = await Promise.all([
    AdModel.updateMany(
      { type: 'mobile' },
      { $unset: { videoUpload: 1 }, $set: { isVideoReady: false } },
    ),
    VideoUploadModel.updateMany(
      { 'resolutions.key': { $regex: /^transcode\/.*\.mp4$/i } },
      { $pull: { resolutions: { key: { $regex: /^transcode\/.*\.mp4$/i } } } },
    ),
  ])

  if (campaignResult.matchedCount !== welcomeCampaigns.length) {
    throw new Error('Welcome campaign count changed during cleanup; storage deletion was stopped')
  }
  summary.clearedLegacyResolutionDocuments = resolutionResult.modifiedCount

  if (welcomeUploadIds.length) {
    await VideoUploadModel.deleteMany({ _id: { $in: welcomeUploadIds } })
  }

  await S3.deleteObjects(unique([...legacyMp4Keys, ...welcomeVideoKeys]), AwsUtils.buckets.reeplay)
  return summary
}

if (require.main === module) {
  void (async () => {
    try {
      await connectMongoDB()
      const summary = await cleanupLegacyMp4AndWelcomeAds(process.argv.includes('--apply'))
      console.log(JSON.stringify(summary, null, 2))
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      await mongoose.connection.close().catch(() => undefined)
    }
  })()
}
