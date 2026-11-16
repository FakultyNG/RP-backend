import { LiveModel } from '../../models/lives.model'
import { VideoModel } from '../../models/videos.model'
import { AnalyticsService } from './AnalyticsService'

type Candidate = {
  id: string
  model: 'live' | 'video'
  owner: string
  type: string
  views: number
  likes: number
  comments: number
  rating: number
  ageDays: number
  recentUniqueViewers?: number
  previousUniqueViewers?: number
  watchSeconds?: number
  completions?: number
  shares?: number
  playStarts?: number
  averageDurationSeconds?: number
  score: number
}

export const AUTO_FEATURED_LIMIT = 10
const AUTO_REFRESH_MS = 3 * 60 * 60 * 1000
const AUTO_EXPIRY_MS = 6 * 60 * 60 * 1000
export const AUTO_REFEATURE_BLOCK_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PER_OWNER = 2
const MAX_PER_TYPE = 4

let lastRefreshAt = 0
let refreshInFlight: Promise<void> | null = null

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(value, 0) : 0

const ageInDays = (value: unknown, now: Date) => {
  const date = value instanceof Date ? value : new Date(String(value ?? now))
  const milliseconds = Number.isNaN(date.getTime()) ? 0 : now.getTime() - date.getTime()
  return Math.max(milliseconds / 86_400_000, 0)
}

export const getAutomaticFeaturedSlots = (manualFeaturedCount: number) =>
  Math.max(AUTO_FEATURED_LIMIT - Math.max(manualFeaturedCount, 0), 0)

export const scoreAutoFeaturedCandidate = (candidate: Omit<Candidate, 'score'>) => {
  const sampleConfidence = Math.min(candidate.views / 100, 1)
  const viewVelocity = Math.log1p(candidate.views / Math.max(candidate.ageDays, 1)) / 10
  const viewStrength = Math.log1p(candidate.views) / 12
  const likeRate = candidate.likes / Math.max(candidate.views, 25)
  const commentRate = candidate.comments / Math.max(candidate.views, 25)
  const ratingQuality = Math.min(candidate.rating / 5, 1)
  const freshness = Math.exp(-candidate.ageDays / 30)

  const recentViewers = candidate.recentUniqueViewers ?? 0
  const previousViewers = candidate.previousUniqueViewers ?? 0
  const hasAnalytics = recentViewers > 0 || (candidate.playStarts ?? 0) > 0
  if (hasAnalytics) {
    const growth = (recentViewers - previousViewers) / Math.max(previousViewers, 10)
    const growthScore = Math.min(Math.max((growth + 1) / 2, 0), 1)
    const completionRate = Math.min(
      (candidate.completions ?? 0) / Math.max(candidate.playStarts ?? recentViewers, 1),
      1,
    )
    const watchRatio = Math.min(
      (candidate.watchSeconds ?? 0) /
        Math.max(recentViewers * (candidate.averageDurationSeconds ?? 0), 1),
      1,
    )
    const shareRate = Math.min((candidate.shares ?? 0) / Math.max(recentViewers, 10) * 10, 1)
    const socialRate = Math.min(likeRate * 15 + commentRate * 30, 1)
    return Number(
      0.25 * growthScore +
      0.25 * completionRate +
      0.15 * watchRatio +
      0.15 * shareRate +
      0.1 * socialRate +
      0.05 * ratingQuality +
      0.05 * freshness,
    )
  }

  return Number((
    0.3 * viewVelocity +
    0.2 * viewStrength +
    0.2 * Math.min(likeRate * 20, 1) +
    0.1 * Math.min(commentRate * 40, 1) +
    0.1 * ratingQuality +
    0.1 * freshness
  ) * (0.5 + 0.5 * sampleConfidence))
}

export class AutoFeaturedService {
  static readonly limit = AUTO_FEATURED_LIMIT

  static refreshIfDue = async (force = false) => {
    if (!force && Date.now() - lastRefreshAt < AUTO_REFRESH_MS) return
    if (refreshInFlight) return refreshInFlight

    refreshInFlight = this.refresh()
      .then(() => {
        lastRefreshAt = Date.now()
      })
      .finally(() => {
        refreshInFlight = null
      })

    return refreshInFlight
  }

  private static refresh = async () => {
    const now = new Date()
    const autoFeaturedBlockedUntil = new Date(now.getTime() + AUTO_REFEATURE_BLOCK_MS)

    await Promise.all([
      VideoModel.updateMany(
        { featured: true, feat_expiry: { $lte: now } },
        {
          $set: { featured: false, autoFeaturedBlockedUntil },
          $unset: { featuredSource: 1, featuredAt: 1, featuredScore: 1, feat_expiry: 1 },
        },
      ),
      LiveModel.updateMany(
        { featured: true, feat_expiry: { $lte: now } },
        {
          $set: { featured: false, autoFeaturedBlockedUntil },
          $unset: { featuredSource: 1, featuredAt: 1, featuredScore: 1, feat_expiry: 1 },
        },
      ),
    ])

    const manualFilter = {
      featured: true,
      featuredSource: { $ne: 'automatic' },
    }
    const [manualVideos, manualLives] = await Promise.all([
      VideoModel.countDocuments(manualFilter),
      LiveModel.countDocuments(manualFilter),
    ])
    const autoSlots = getAutomaticFeaturedSlots(manualVideos + manualLives)

    if (autoSlots === 0) {
      await this.clearUnselectedAutomatic([], [])
      return
    }

    const selectableFilter = {
      $and: [
        {
          $or: [
            { featured: { $ne: true } },
            { featuredSource: 'automatic' },
          ],
        },
        {
          $or: [
            { autoFeaturedBlockedUntil: { $exists: false } },
            { autoFeaturedBlockedUntil: { $lte: now } },
          ],
        },
      ],
    }

    const [videos, lives] = await Promise.all([
      VideoModel.find({
        ...selectableFilter,
        active: true,
        releaseDate: { $lte: now },
        expiryDate: { $gt: now },
        'portraitPhoto.Key': { $exists: true },
        'landscapePhoto.Key': { $exists: true },
        $and: [
          ...selectableFilter.$and,
          {
            $or: [
              { type: 'series' },
              { isVideoReady: true, isTrailerReady: true },
            ],
          },
        ],
      })
        .select('_id adminId type viewsCount likesCount commentsCount averageRating releaseDate createdAt')
        .sort({ engagements: -1, viewsCount: -1 })
        .limit(250)
        .lean(),
      LiveModel.find({
        ...selectableFilter,
        active: true,
        start: { $lte: now },
        expiry: { $gt: now },
        payment_id: { $exists: true },
        'coverPhoto.Key': { $exists: true },
      })
        .select('_id client_id type viewsCount likesCount commentsCount start createdAt')
        .sort({ engagements: -1, viewsCount: -1 })
        .limit(250)
        .lean(),
    ])

    const baseCandidates: Omit<Candidate, 'score'>[] = [
      ...videos.map(video => {
        const base = {
          id: video._id.toString(),
          model: 'video' as const,
          owner: video.adminId.toString(),
          type: video.type,
          views: asNumber(video.viewsCount),
          likes: asNumber(video.likesCount),
          comments: asNumber(video.commentsCount),
          rating: asNumber(video.averageRating),
          ageDays: ageInDays(video.releaseDate ?? video.createdAt, now),
        }
        return base
      }),
      ...lives.map(live => {
        const base = {
          id: live._id.toString(),
          model: 'live' as const,
          owner: live.client_id.toString(),
          type: live.type,
          views: asNumber(live.viewsCount),
          likes: asNumber(live.likesCount),
          comments: asNumber(live.commentsCount),
          rating: 0,
          ageDays: ageInDays(live.start ?? live.createdAt, now),
        }
        return base
      }),
    ]
    const analytics = await AnalyticsService.rankingMetrics(baseCandidates.map(item => item.id))
    const candidates: Candidate[] = baseCandidates.map(base => {
      const metric = analytics.get(base.id)
      const enriched = metric
        ? {
          ...base,
          recentUniqueViewers: metric.uniqueViewers,
          previousUniqueViewers: metric.previousUniqueViewers,
          watchSeconds: metric.watchSeconds,
          completions: metric.completions,
          shares: metric.shares,
          playStarts: metric.playStarts,
          averageDurationSeconds: metric.averageDurationSeconds,
        }
        : base
      return { ...enriched, score: scoreAutoFeaturedCandidate(enriched) }
    }).sort((a, b) => b.score - a.score)

    const selected: Candidate[] = []
    const owners = new Map<string, number>()
    const types = new Map<string, number>()

    for (const candidate of candidates) {
      if (selected.length >= autoSlots) break
      if ((owners.get(candidate.owner) ?? 0) >= MAX_PER_OWNER) continue
      if ((types.get(candidate.type) ?? 0) >= MAX_PER_TYPE) continue
      selected.push(candidate)
      owners.set(candidate.owner, (owners.get(candidate.owner) ?? 0) + 1)
      types.set(candidate.type, (types.get(candidate.type) ?? 0) + 1)
    }

    for (const candidate of candidates) {
      if (selected.length >= autoSlots) break
      if (selected.some(item => item.id === candidate.id)) continue
      selected.push(candidate)
    }

    const selectedVideoIds = selected.filter(item => item.model === 'video').map(item => item.id)
    const selectedLiveIds = selected.filter(item => item.model === 'live').map(item => item.id)
    await this.clearUnselectedAutomatic(selectedVideoIds, selectedLiveIds)

    const autoExpiry = new Date(now.getTime() + AUTO_EXPIRY_MS)
    await Promise.all(selected.map(candidate => {
      const update = {
        $set: {
          featured: true,
          featuredSource: 'automatic' as const,
          featuredAt: now,
          featuredScore: candidate.score,
          feat_expiry: autoExpiry,
        },
      }
      return candidate.model === 'video'
        ? VideoModel.updateOne(
          { _id: candidate.id, featuredSource: { $ne: 'manual' } },
          update,
        )
        : LiveModel.updateOne(
          { _id: candidate.id, featuredSource: { $ne: 'manual' } },
          update,
        )
    }))
  }

  private static clearUnselectedAutomatic = async (
    selectedVideoIds: string[],
    selectedLiveIds: string[],
  ) => {
    await Promise.all([
      VideoModel.updateMany(
        { featuredSource: 'automatic', _id: { $nin: selectedVideoIds } },
        {
          $set: { featured: false },
          $unset: { featuredSource: 1, featuredAt: 1, featuredScore: 1, feat_expiry: 1 },
        },
      ),
      LiveModel.updateMany(
        { featuredSource: 'automatic', _id: { $nin: selectedLiveIds } },
        {
          $set: { featured: false },
          $unset: { featuredSource: 1, featuredAt: 1, featuredScore: 1, feat_expiry: 1 },
        },
      ),
    ])
  }
}
