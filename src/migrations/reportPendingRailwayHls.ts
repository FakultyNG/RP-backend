import mongoose from 'mongoose'
import { AdModel } from '../models/admanager.model'
import { EpisodeModel } from '../models/episodes.model'
import { LiveModel } from '../models/lives.model'
import { SeasonModel } from '../models/seasons.model'
import { VideoUploadModel } from '../models/videoupload.model'
import { VideoModel } from '../models/videos.model'
import { connectMongoDB } from '../utils/connectDB'

const resolveParent = async (parentType: string | undefined, parentId: unknown) => {
  const id = parentId?.toString()
  if (!id) return { title: 'Unassigned upload' }

  if (parentType === 'ad') {
    const ad = await AdModel.findById(id).select('title brand').lean()
    return { title: ad?.title ?? 'Deleted ad', brand: ad?.brand }
  }

  if (parentType === 'episode' || parentType === 'episode-trailer') {
    const episode = await EpisodeModel.findById(id).select('title episodeNumber season').lean()
    const season = episode
      ? await SeasonModel.findById(episode.season).select('serial_number video').lean()
      : null
    const video = season ? await VideoModel.findById(season.video).select('title').lean() : null
    return {
      title: video?.title ?? 'Deleted series',
      season: season?.serial_number,
      episode: episode?.episodeNumber,
      episodeTitle: episode?.title,
    }
  }

  if (parentType?.startsWith('live')) {
    const live = await LiveModel.findById(id).select('title name').lean()
    return { title: live?.title ?? live?.name ?? 'Deleted live content' }
  }

  const video = await VideoModel.findById(id).select('title type').lean()
  return { title: video?.title ?? 'Deleted VOD', contentType: video?.type }
}

const report = async () => {
  const uploads = await VideoUploadModel.find({ hlsStatus: { $ne: 'ready' } })
    .sort({ parentType: 1, parentId: 1 })
    .lean()

  const rows = await Promise.all(
    uploads.map(async upload => ({
      uploadId: upload._id.toString(),
      parentId: upload.parentId?.toString(),
      uploadType: upload.parentType ?? 'unassigned',
      hlsStatus: upload.hlsStatus,
      reason: upload.hlsError ?? 'Not submitted for HLS conversion',
      ...(await resolveParent(upload.parentType, upload.parentId)),
    })),
  )

  console.log(JSON.stringify({ count: rows.length, uploads: rows }, null, 2))
}

if (require.main === module) {
  void (async () => {
    try {
      await connectMongoDB()
      await report()
      await mongoose.connection.close()
    } catch (error) {
      console.error(error)
      await mongoose.connection.close().catch(() => undefined)
      process.exitCode = 1
    }
  })()
}

