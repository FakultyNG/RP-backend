import {Types} from 'mongoose'
import {TopTenModel} from '../../models/topTen.model'
import {VideoModel} from '../../models/videos.model'
import {VideoRepo} from '../../repositories/VideoRepo'
import {LoggedInUser} from '../../types'
import {filterGuestVods} from '../../utils/guestAccess'
import {MovieMediaSourcesUtils} from '../../utils/MovieMediaSourcesUtils'
import {OperationalError} from '../../utils/OperationalError'

export const TOP_TEN_LIMIT = 10

export const normalizeTopTenVideoIds = (videoIds: unknown): string[] => {
  if (!Array.isArray(videoIds)) {
    throw new OperationalError('videoIds must be an array', 400)
  }
  if (videoIds.length > TOP_TEN_LIMIT) {
    throw new OperationalError('Top 10 cannot contain more than 10 titles', 409)
  }

  const normalized = videoIds.map(id => String(id))
  if (normalized.some(id => !Types.ObjectId.isValid(id))) {
    throw new OperationalError('Top 10 contains an invalid title id', 400)
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new OperationalError('A title can only appear once in Top 10', 409)
  }
  return normalized
}

export class TopTenService {
  private static async configuredIds() {
    const config = await TopTenModel.findOne({key: 'home'}).select('videoIds').lean()
    return (config?.videoIds ?? []).map(id => id.toString()).slice(0, TOP_TEN_LIMIT)
  }

  static async getPublic(currentUser: LoggedInUser) {
    const ids = await this.configuredIds()
    if (ids.length === 0) return []
    const vods = await VideoRepo.fetchTopTen(ids)
    return MovieMediaSourcesUtils.resolveMediaSources(
      filterGuestVods(vods, currentUser),
      currentUser.videoQuality,
    )
  }

  static async getAdmin() {
    const ids = await this.configuredIds()
    if (ids.length === 0) return []
    const vods = await VideoRepo.fetchTopTen(ids, true)
    return MovieMediaSourcesUtils.resolveMediaSources(vods, '720p')
  }

  static async replace(videoIds: unknown) {
    const normalized = normalizeTopTenVideoIds(videoIds)
    const now = new Date()

    if (normalized.length > 0) {
      const videos = await VideoModel.find({_id: {$in: normalized}})
        .select('title type active releaseDate expiryDate isVideoReady isTrailerReady')
        .lean()

      if (videos.length !== normalized.length) {
        throw new OperationalError('One or more selected titles no longer exist', 404)
      }

      const unavailable = videos.filter(video => {
        const released = video.releaseDate != null && video.releaseDate <= now
        const unexpired = video.expiryDate != null && video.expiryDate > now
        const ready =
          video.type === 'series' || (video.isVideoReady === true && video.isTrailerReady === true)
        return video.active !== true || !released || !unexpired || !ready
      })

      if (unavailable.length > 0) {
        throw new OperationalError(
          `Top 10 only accepts active, released, unexpired and ready titles: ${unavailable
            .map(video => video.title)
            .join(', ')}`,
          409,
        )
      }
    }

    await TopTenModel.findOneAndUpdate(
      {key: 'home'},
      {$set: {videoIds: normalized}},
      {upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true},
    )
    return this.getAdmin()
  }

  static async autoRank() {
    const candidates = await VideoRepo.fetchTopTenCandidates()
    return this.replace(candidates.map(candidate => candidate._id.toString()))
  }
}
