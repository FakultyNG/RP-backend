import mongoose from 'mongoose'
import { VideoUpload, VideoUploadModel } from '../models/videoupload.model'
import { MediaConvert } from '../services/aws/mediaConvert'
import { S3 } from '../services/aws/s3'
import { connectMongoDB } from '../utils/connectDB'
import { CronTaskHandlers } from '../cron/CronTaskHandlers'
import { VideoModel } from '../models/videos.model'
import { EpisodeModel } from '../models/episodes.model'
import { SeasonModel } from '../models/seasons.model'
import { LiveModel } from '../models/lives.model'
import { AdModel } from '../models/admanager.model'

type MigrationSummary = {
  total: number
  ready: number
  submitted: number
  processing: number
  failed: number
  legacyMp4Deleted: number
  failures: Array<{ uploadId: string; parentType?: string; parentId?: string; reason: string }>
}

const expectedMasterKey = (document: VideoUpload) =>
  document.hlsKey || MediaConvert.getHlsMasterKey(document.key)

const markParentUnavailable = async (document: VideoUpload) => {
  switch (document.parentType) {
    case 'vod':
      await VideoModel.findByIdAndUpdate(document.parentId, { isVideoReady: false })
      break
    case 'vod-trailer':
    case 'trailer' as VideoUpload['parentType']:
      await VideoModel.findByIdAndUpdate(document.parentId, { isTrailerReady: false })
      break
    case 'episode':
      await EpisodeModel.findByIdAndUpdate(document.parentId, { isVideoReady: false })
      break
    case 'episode-trailer':
      await EpisodeModel.findByIdAndUpdate(document.parentId, { isTrailerReady: false })
      break
    case 'season-trailer':
      await SeasonModel.findByIdAndUpdate(document.parentId, { isTrailerReady: false })
      break
    case 'live':
      await LiveModel.findByIdAndUpdate(document.parentId, { isPreviewVideoReady: false })
      break
    case 'ad':
      await AdModel.findByIdAndUpdate(document.parentId, { isVideoReady: false })
      break
    default:
      break
  }
}

const updateHlsFields = async (
  document: VideoUpload,
  fields: Partial<Pick<VideoUpload, 'hlsKey' | 'hlsStatus' | 'hlsJobId' | 'hlsError' | 'isTranscoded'>>,
) => {
  // Some production uploads predate the current parentType enum. Updating only
  // the migration-owned fields avoids validating or rewriting that legacy data.
  await VideoUploadModel.updateOne({ _id: document._id }, { $set: fields })
  Object.assign(document, fields)
}

const syncDocumentStatus = async (document: VideoUpload) => {
  const hlsKey = expectedMasterKey(document)

  if (await S3.objectExists(hlsKey)) {
    await updateHlsFields(document, {
      hlsKey,
      hlsStatus: 'ready',
      hlsError: null,
      isTranscoded: true,
    })
    await CronTaskHandlers.updateVideoUploadDoc(document)
    return 'ready' as const
  }

  if (document.hlsJobId) {
    const job = await MediaConvert.getJob(document.hlsJobId)
    if (job?.Status === 'SUBMITTED' || job?.Status === 'PROGRESSING') {
      await updateHlsFields(document, { hlsKey, hlsStatus: 'processing' })
      return 'processing' as const
    }

    if (job?.Status === 'ERROR' || job?.Status === 'CANCELED') {
      await updateHlsFields(document, {
        hlsStatus: 'failed',
        hlsError: job.ErrorMessage ?? `MediaConvert job ${job.Status.toLowerCase()}`,
      })
    }
  }

  return 'submit' as const
}

const submitDocument = async (document: VideoUpload) => {
  try {
    if (!(await S3.objectExists(document.key))) {
      const legacyCandidates = [...document.resolutions].sort(
        (left, right) => Number(right.resolution) - Number(left.resolution),
      )
      let recoveredFrom: string | null = null
      for (const candidate of legacyCandidates) {
        if (await S3.objectExists(candidate.key)) {
          recoveredFrom = candidate.key
          break
        }
      }

      if (!recoveredFrom) {
        throw new Error('Original upload and legacy MP4 renditions are missing')
      }

      await S3.copyObject(recoveredFrom, document.key)
    }

    const job = await MediaConvert.transcode(document.key)
    await updateHlsFields(document, {
      hlsKey: MediaConvert.getHlsMasterKey(document.key),
      hlsJobId: job.Job?.Id ?? null,
      hlsStatus: 'processing',
      hlsError: null,
    })
    return true
  } catch (error: any) {
    await updateHlsFields(document, {
      hlsStatus: 'failed',
      hlsError: error?.message ?? 'Unable to submit Railway HLS job',
    })
    await markParentUnavailable(document)
    return false
  }
}

const deleteVerifiedLegacyMp4s = async () => {
  if (process.env.ALLOW_DELETE_LEGACY_MP4 !== 'true') {
    throw new Error(
      'Refusing legacy MP4 deletion. Set ALLOW_DELETE_LEGACY_MP4=true after offline-download migration is complete.',
    )
  }

  const documents = await VideoUploadModel.find({ key: { $exists: true, $ne: '' } })
  const unverified: string[] = []

  for (const document of documents) {
    if (
      document.hlsStatus !== 'ready' ||
      !document.hlsKey ||
      !(await S3.objectExists(document.hlsKey))
    ) {
      unverified.push(document._id.toString())
    }
  }

  if (unverified.length) {
    throw new Error(
      `Refusing deletion: ${unverified.length} video uploads do not have a verified HLS master playlist.`,
    )
  }

  let deleted = 0
  for (const document of documents) {
    const legacyKeys = (await S3.listKeys(`transcode/${document.key}`)).filter(key =>
      key.toLowerCase().endsWith('.mp4'),
    )
    await S3.deleteObjects(legacyKeys)
    deleted += legacyKeys.length
  }

  return deleted
}

const deleteAllLegacyMp4s = async () => {
  if (process.env.ALLOW_DELETE_LEGACY_MP4 !== 'true') {
    throw new Error('Refusing legacy MP4 deletion without ALLOW_DELETE_LEGACY_MP4=true.')
  }

  const legacyKeys = (await S3.listKeys('transcode/')).filter(
    key => key.startsWith('transcode/') && key.toLowerCase().endsWith('.mp4'),
  )
  await S3.deleteObjects(legacyKeys)
  return legacyKeys.length
}

export const migrateRailwayHls = async ({
  deleteLegacyMp4 = false,
  deleteAllLegacyMp4 = false,
  submitMissing = true,
  limit,
}: {
  deleteLegacyMp4?: boolean
  deleteAllLegacyMp4?: boolean
  submitMissing?: boolean
  limit?: number
} = {}): Promise<MigrationSummary> => {
  const summary: MigrationSummary = {
    total: 0,
    ready: 0,
    submitted: 0,
    processing: 0,
    failed: 0,
    legacyMp4Deleted: 0,
    failures: [],
  }

  let query = VideoUploadModel.find({ key: { $exists: true, $ne: '' } }).sort({ size: 1, _id: 1 })
  if (limit && limit > 0) query = query.limit(limit)
  const cursor = query.cursor()

  for await (const document of cursor) {
    summary.total += 1
    const state = await syncDocumentStatus(document)

    if (state === 'ready') {
      summary.ready += 1
      continue
    }

    if (state === 'processing') {
      summary.processing += 1
      continue
    }

    if (!submitMissing) {
      summary.failed += 1
    } else if (await submitDocument(document)) {
      summary.submitted += 1
    } else {
      summary.failed += 1
    }

    if ((!submitMissing || document.hlsStatus === 'failed') && document.hlsStatus !== 'processing') {
      summary.failures.push({
        uploadId: document._id.toString(),
        parentType: document.parentType ?? undefined,
        parentId: document.parentId?.toString(),
        reason: document.hlsError ?? 'HLS master playlist is missing',
      })
    }
  }

  if (deleteLegacyMp4) {
    summary.legacyMp4Deleted = await deleteVerifiedLegacyMp4s()
  }
  if (deleteAllLegacyMp4) {
    summary.legacyMp4Deleted = await deleteAllLegacyMp4s()
  }

  return summary
}

if (require.main === module) {
  void (async () => {
    try {
      await connectMongoDB()
      const limitArgument = process.argv.find(argument => argument.startsWith('--limit='))
      const limit = limitArgument ? Number(limitArgument.split('=')[1]) : undefined
      const summary = await migrateRailwayHls({
        deleteLegacyMp4: process.argv.includes('--delete-legacy-mp4'),
        deleteAllLegacyMp4: process.argv.includes('--delete-all-legacy-mp4'),
        submitMissing: !process.argv.includes('--no-submit'),
        limit: Number.isFinite(limit) ? limit : undefined,
      })
      console.log(JSON.stringify(summary, null, 2))
      await mongoose.connection.close()
    } catch (error) {
      console.error(error)
      await mongoose.connection.close().catch(() => undefined)
      process.exitCode = 1
    }
  })()
}
