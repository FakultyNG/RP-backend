import { LiveRepo } from '../../repositories/LiveRepo'
import { VideoRepo } from '../../repositories/VideoRepo'
import { LoggedInUser } from '../../types'
import { LiveMediaSourcesUtils } from '../../utils/LiveMediaSourcesUtils'
import { MovieMediaSourcesUtils } from '../../utils/MovieMediaSourcesUtils'
import { OperationalError } from '../../utils/OperationalError'
import { ExpressRequestQuery, guranteeNumericResult } from '../../utils/QueryParamsFeatures'
import { VideoQuality } from '../../utils/VideoUploadUtils'
import { filterGuestLives, filterGuestVods } from '../../utils/guestAccess'
import { LiveStreamService } from './LiveStreamService'
import { VideoService } from './VideoService'
import { AutoFeaturedService } from './AutoFeaturedService'
import { VideoModel } from '../../models/videos.model'
import { LiveModel } from '../../models/lives.model'
import { escapeSearchText } from '../../utils/SearchRelevance'

type AddFeaturedInput = {
  type: 'vod' | 'event'
  id: string
  expiry: string
}

export class FeaturedService {
  static searchVideosByText = async (text: string, user: LoggedInUser | undefined) => {
    const reg = new RegExp(escapeSearchText(text.trim()), 'i')
    const quality: VideoQuality = user?.videoQuality || '480p'

    const [vods, events] = await Promise.all([
      VideoRepo.searchVodContentByRegex(reg),
      LiveMediaSourcesUtils.resolveSources(await LiveRepo.searchLivesByTextReg(reg), quality),
    ])

    return {
      vods: MovieMediaSourcesUtils.resolveMediaSources(filterGuestVods(vods, user), quality),
      events: filterGuestLives(events, user),
    }
  }

  static addFeatured = async ({ id, type, expiry }: AddFeaturedInput) => {
    await AutoFeaturedService.refreshIfDue(true)
    const [target, manualVideos, manualLives] = await Promise.all([
      type === 'vod'
        ? VideoModel.findById(id).select('featured featuredSource').lean()
        : LiveModel.findById(id).select('featured featuredSource').lean(),
      VideoModel.countDocuments({ featured: true, featuredSource: { $ne: 'automatic' } }),
      LiveModel.countDocuments({ featured: true, featuredSource: { $ne: 'automatic' } }),
    ])

    if (target === null) throw new OperationalError('Invalid Id', 404)
    const alreadyManual = target.featured && target.featuredSource !== 'automatic'
    if (!alreadyManual && manualVideos + manualLives >= AutoFeaturedService.limit) {
      throw new OperationalError('Only 10 manually featured contents are allowed', 409)
    }

    const newFeatured =
      type === 'vod'
        ? await VideoService.addFeatured(id, expiry)
        : await LiveStreamService.addFeatured(id, expiry)

    if (newFeatured === null) {
      throw new OperationalError('Invalid Id', 404)
    }

    await AutoFeaturedService.refreshIfDue(true)
  }

  static getFeaturedContents = async (query: ExpressRequestQuery) => {
    await AutoFeaturedService.refreshIfDue()
    const page = Math.max(guranteeNumericResult(query.page, 1), 1)
    const limit = Math.max(Math.min(guranteeNumericResult(query.limit, 50), 100), 1)
    const fetchWindow = page * limit

    const [vods, events] = await Promise.all([
      VideoRepo.adminFetchFeatured(1, fetchWindow),
      LiveRepo.getAdminFeatured(1, fetchWindow),
    ])

    const combined = [
      ...vods.map(content => ({ kind: 'vod' as const, content })),
      ...events.map(content => ({ kind: 'live' as const, content })),
    ].sort((a, b) => {
      const aManual = (a.content as any).featuredSource !== 'automatic'
      const bManual = (b.content as any).featuredSource !== 'automatic'
      if (aManual !== bManual) return aManual ? -1 : 1
      const aExpiry = new Date(
        (a.content as any).feat_expiry ?? (a.content as any).featExpiry ?? 0,
      ).getTime()
      const bExpiry = new Date(
        (b.content as any).feat_expiry ?? (b.content as any).featExpiry ?? 0,
      ).getTime()
      if (aExpiry !== bExpiry) return bExpiry - aExpiry
      return String((b.content as any)._id).localeCompare(String((a.content as any)._id))
    })

    const pageContents = combined.slice((page - 1) * limit, page * limit)
    const pageVods = pageContents
      .filter(item => item.kind === 'vod')
      .map(item => item.content)
    const pageEvents = pageContents
      .filter(item => item.kind === 'live')
      .map(item => item.content)

    return {
      vods_contents: MovieMediaSourcesUtils.resolveMediaSources(pageVods, '720p'),
      lives_contents: await LiveMediaSourcesUtils.resolveSources(pageEvents, '720p'),
    }
  }
}
