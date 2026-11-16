import mongoose from 'mongoose'
import { VideoUpload, VideoUploadModel } from '../models/videoupload.model'
import { MediaConvert } from '../services/aws/mediaConvert'
import { S3 } from '../services/aws/s3'
import { connectMongoDB } from '../utils/connectDB'

type MigrationSummary = {
  total: number
  ready: number
  submitted: number
  processing: number
  failed: number
  legacyMp4Deleted: number
}

const expectedMasterKey = (document: VideoUpload) =>
  document.hlsKey || MediaConvert.getHlsMasterKey(document.key)

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

export const migrateRailwayHls = async ({
  deleteLegacyMp4 = false,
  limit,
}: {
  deleteLegacyMp4?: boolean
  limit?: number
} = {}): Promise<MigrationSummary> => {
  const summary: MigrationSummary = {
    total: 0,
    ready: 0,
    submitted: 0,
    processing: 0,
    failed: 0,
    legacyMp4Deleted: 0,
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

    if (await submitDocument(document)) {
      summary.submitted += 1
    } else {
      summary.failed += 1
    }
  }

  if (deleteLegacyMp4) {
    summary.legacyMp4Deleted = await deleteVerifiedLegacyMp4s()
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
