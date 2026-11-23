import { createHash } from 'crypto'
import { Types } from 'mongoose'
import {
  AnalyticsActiveViewerDayModel,
  AnalyticsIdentityModel,
  analyticsContentTypes,
  analyticsDeviceClasses,
  analyticsEventTypes,
  analyticsPlatforms,
  ContentAnalyticsDailyModel,
  ContentAnalyticsEventModel,
  ContentAnalyticsViewerDayModel,
} from '../../models/contentAnalytics.model'
import { LiveModel } from '../../models/lives.model'
import { VideoModel } from '../../models/videos.model'
import { EpisodeModel } from '../../models/episodes.model'
import { PaymentModel } from '../../models/payments.model'
import { UserModel } from '../../models/users.model'
import { AdModel } from '../../models/admanager.model'

export type AnalyticsEventInput = {
  eventId: string
  sessionId: string
  contentId?: string
  contentType?: (typeof analyticsContentTypes)[number]
  eventType: (typeof analyticsEventTypes)[number]
  positionSeconds?: number
  durationSeconds?: number
  watchedSeconds?: number
  completionPercent?: number
  shareDestination?: string
  screenName?: string
  sourceScreen?: string
  searchTerm?: string
  adId?: string
  notificationId?: string
  appVersion?: string
  platform?: (typeof analyticsPlatforms)[number]
  osVersion?: string
  deviceClass?: (typeof analyticsDeviceClasses)[number]
  networkType?: string
  quality?: string
  errorCode?: string
  startupMs?: number
  bufferingSeconds?: number
  occurredAt?: string
}

export type AnalyticsReportFilters = {
  days?: number
  platform?: (typeof analyticsPlatforms)[number] | 'all'
  contentType?: (typeof analyticsContentTypes)[number] | 'all'
}

type RankingMetric = {
  uniqueViewers: number
  previousUniqueViewers: number
  watchSeconds: number
  completions: number
  shares: number
  playStarts: number
  averageDurationSeconds: number
}

const utcDay = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))

const safeDate = (value?: string) => {
  const parsed = value ? new Date(value) : new Date()
  const now = Date.now()
  if (Number.isNaN(parsed.getTime()) || Math.abs(parsed.getTime() - now) > 24 * 60 * 60 * 1000) {
    return new Date()
  }
  return parsed
}

export class AnalyticsService {
  static viewerKey = (identity: string) =>
    createHash('sha256')
      .update(`${process.env.JWT_SECRET ?? 'reeplay-analytics'}:${identity}`)
      .digest('hex')

  static ingest = async (
    identity: string,
    events: AnalyticsEventInput[],
    options: { registered?: boolean } = {},
  ) => {
    const viewerKey = this.viewerKey(identity)
    let accepted = 0

    const firstEvent = events[0]
    const now = new Date()
    await Promise.all([
      AnalyticsIdentityModel.updateOne(
        { viewerKey },
        {
          $setOnInsert: { viewerKey, firstSeenAt: now },
          $set: {
            lastSeenAt: now,
            platform: firstEvent?.platform ?? 'unknown',
            appVersion: firstEvent?.appVersion,
            deviceClass: firstEvent?.deviceClass ?? 'unknown',
            registered: options.registered !== false,
          },
        },
        { upsert: true },
      ),
      AnalyticsActiveViewerDayModel.updateOne(
        { viewerKey, day: utcDay(now) },
        {
          $setOnInsert: {
            viewerKey,
            day: utcDay(now),
            platform: firstEvent?.platform ?? 'unknown',
            appVersion: firstEvent?.appVersion,
          },
        },
        { upsert: true },
      ),
    ])

    await Promise.all(events.map(async input => {
      const occurredAt = safeDate(input.occurredAt)
      const day = utcDay(occurredAt)
      const durationSeconds = Math.max(Number(input.durationSeconds) || 0, 0)
      const positionSeconds = Math.max(Number(input.positionSeconds) || 0, 0)
      const watchedSeconds = Math.min(Math.max(Number(input.watchedSeconds) || 0, 0), 60)
      const completionPercent = Math.min(
        Math.max(Number(input.completionPercent) || 0, 0),
        100,
      )
      const bufferingSeconds = Math.min(
        Math.max(Number(input.bufferingSeconds) || 0, 0),
        300,
      )
      const startupMs = Math.min(Math.max(Number(input.startupMs) || 0, 0), 300_000)
      const contentId = input.contentId && Types.ObjectId.isValid(input.contentId)
        ? new Types.ObjectId(input.contentId)
        : undefined
      const adId = input.adId && Types.ObjectId.isValid(input.adId)
        ? new Types.ObjectId(input.adId)
        : undefined

      const inserted = await ContentAnalyticsEventModel.updateOne(
        { eventId: input.eventId },
        {
          $setOnInsert: {
            ...input,
            contentId,
            adId,
            viewerKey,
            occurredAt,
            day,
            durationSeconds,
            positionSeconds,
            watchedSeconds,
            completionPercent,
            bufferingSeconds,
            startupMs,
          },
        },
        { upsert: true },
      )
      if (inserted.upsertedCount !== 1) return
      accepted += 1

      const increments: Record<string, number> = {}
      if (input.eventType === 'play_start') {
        increments.playStarts = 1
        if (durationSeconds > 0) {
          increments.durationSecondsTotal = durationSeconds
          increments.durationSamples = 1
        }
      }
      if (input.eventType === 'progress') increments.watchSeconds = watchedSeconds
      if (input.eventType === 'complete') increments.completions = 1
      if (input.eventType === 'share') increments.shares = 1
      if (input.eventType === 'playback_error') increments.playbackErrors = 1
      if (input.eventType === 'buffer') {
        increments.bufferEvents = 1
        increments.bufferingSeconds = bufferingSeconds
      }
      if (input.eventType === 'playback_ready' && startupMs > 0) {
        increments.startupMsTotal = startupMs
        increments.startupSamples = 1
      }

      const qualifiesAsViewer =
        contentId != null &&
        input.contentType != null &&
        (input.eventType === 'complete' ||
          (input.eventType === 'progress' &&
            (completionPercent >= 10 || positionSeconds >= 30)))
      if (qualifiesAsViewer) {
        const unique = await ContentAnalyticsViewerDayModel.updateOne(
          { contentId, contentType: input.contentType, day, viewerKey },
          { $setOnInsert: { contentId, contentType: input.contentType, day, viewerKey } },
          { upsert: true },
        )
        if (unique.upsertedCount === 1) increments.uniqueViewers = 1
      }

      if (contentId && input.contentType && Object.keys(increments).length > 0) {
        await ContentAnalyticsDailyModel.updateOne(
          { contentId, contentType: input.contentType, day },
          {
            $setOnInsert: { contentId, contentType: input.contentType, day },
            $inc: increments,
          },
          { upsert: true },
        )
      }
    }))

    return { accepted, duplicates: events.length - accepted }
  }

  static rankingMetrics = async (ids: string[], days = 7) => {
    if (ids.length === 0) return new Map<string, RankingMetric>()
    const now = utcDay(new Date())
    const currentStart = new Date(now.getTime() - (days - 1) * 86_400_000)
    const previousStart = new Date(currentStart.getTime() - days * 86_400_000)
    const rows = await ContentAnalyticsDailyModel.aggregate<{
      _id: Types.ObjectId
      current: Omit<RankingMetric, 'previousUniqueViewers' | 'averageDurationSeconds'> & {
        durationSecondsTotal: number
        durationSamples: number
      }
      previousUniqueViewers: number
    }>([
      { $match: { contentId: { $in: ids.map(id => new Types.ObjectId(id)) }, day: { $gte: previousStart } } },
      {
        $group: {
          _id: '$contentId',
          uniqueViewers: { $sum: { $cond: [{ $gte: ['$day', currentStart] }, '$uniqueViewers', 0] } },
          previousUniqueViewers: { $sum: { $cond: [{ $lt: ['$day', currentStart] }, '$uniqueViewers', 0] } },
          watchSeconds: { $sum: { $cond: [{ $gte: ['$day', currentStart] }, '$watchSeconds', 0] } },
          completions: { $sum: { $cond: [{ $gte: ['$day', currentStart] }, '$completions', 0] } },
          shares: { $sum: { $cond: [{ $gte: ['$day', currentStart] }, '$shares', 0] } },
          playStarts: { $sum: { $cond: [{ $gte: ['$day', currentStart] }, '$playStarts', 0] } },
          durationSecondsTotal: { $sum: { $cond: [{ $gte: ['$day', currentStart] }, '$durationSecondsTotal', 0] } },
          durationSamples: { $sum: { $cond: [{ $gte: ['$day', currentStart] }, '$durationSamples', 0] } },
        },
      },
    ])

    return new Map(rows.map((row: any) => [row._id.toString(), {
      uniqueViewers: row.uniqueViewers,
      previousUniqueViewers: row.previousUniqueViewers,
      watchSeconds: row.watchSeconds,
      completions: row.completions,
      shares: row.shares,
      playStarts: row.playStarts,
      averageDurationSeconds: row.durationSamples > 0
        ? row.durationSecondsTotal / row.durationSamples
        : 0,
    }]))
  }

  static adminOverview = async (days = 7) => {
    const safeDays = Math.min(Math.max(days, 1), 90)
    const start = utcDay(new Date(Date.now() - (safeDays - 1) * 86_400_000))
    const [[summary], [viewerSummary]] = await Promise.all([
      ContentAnalyticsDailyModel.aggregate([
        { $match: { day: { $gte: start } } },
        {
          $group: {
            _id: null,
            watchSeconds: { $sum: '$watchSeconds' },
            completions: { $sum: '$completions' },
            shares: { $sum: '$shares' },
            playStarts: { $sum: '$playStarts' },
          },
        },
      ]),
      ContentAnalyticsViewerDayModel.aggregate([
        { $match: { day: { $gte: start } } },
        { $group: { _id: '$viewerKey' } },
        { $count: 'uniqueViewers' },
      ]),
    ])
    const trend = await ContentAnalyticsDailyModel.aggregate([
      { $match: { day: { $gte: start } } },
      { $group: { _id: '$day', uniqueViewers: { $sum: '$uniqueViewers' }, watchSeconds: { $sum: '$watchSeconds' }, completions: { $sum: '$completions' }, shares: { $sum: '$shares' } } },
      { $sort: { _id: 1 } },
    ])
    const topViewers = await ContentAnalyticsViewerDayModel.aggregate([
      { $match: { day: { $gte: start }, contentType: { $in: ['vod', 'live'] } } },
      { $group: { _id: { contentId: '$contentId', contentType: '$contentType', viewerKey: '$viewerKey' } } },
      { $group: { _id: { contentId: '$_id.contentId', contentType: '$_id.contentType' }, uniqueViewers: { $sum: 1 } } },
      { $sort: { uniqueViewers: -1 } },
      { $limit: 10 },
    ])
    const topIds = topViewers.map(row => row._id.contentId)
    const topMetrics = await ContentAnalyticsDailyModel.aggregate([
      { $match: { day: { $gte: start }, contentId: { $in: topIds } } },
      { $group: { _id: { contentId: '$contentId', contentType: '$contentType' }, watchSeconds: { $sum: '$watchSeconds' }, completions: { $sum: '$completions' }, shares: { $sum: '$shares' }, playStarts: { $sum: '$playStarts' } } },
    ])
    const metricByContent = new Map(topMetrics.map(row => [row._id.contentId.toString(), row]))
    const top = topViewers.map(row => ({
      ...row,
      ...(metricByContent.get(row._id.contentId.toString()) ?? {
        watchSeconds: 0,
        completions: 0,
        shares: 0,
        playStarts: 0,
      }),
    }))
    const videoIds = top.filter(row => row._id.contentType === 'vod').map(row => row._id.contentId)
    const liveIds = top.filter(row => row._id.contentType === 'live').map(row => row._id.contentId)
    const [videos, lives] = await Promise.all([
      VideoModel.find({ _id: { $in: videoIds } }).select('title').lean(),
      LiveModel.find({ _id: { $in: liveIds } }).select('title').lean(),
    ])
    const titles = new Map([...videos, ...lives].map(item => [item._id.toString(), item.title]))

    return {
      days: safeDays,
      summary: {
        uniqueViewers: viewerSummary?.uniqueViewers ?? 0,
        watchHours: Number(((summary?.watchSeconds ?? 0) / 3600).toFixed(1)),
        completions: summary?.completions ?? 0,
        shares: summary?.shares ?? 0,
        completionRate: summary?.playStarts > 0
          ? Number(((summary.completions / summary.playStarts) * 100).toFixed(1))
          : 0,
      },
      trend: trend.map(row => ({ day: row._id, uniqueViewers: row.uniqueViewers, watchHours: Number((row.watchSeconds / 3600).toFixed(1)), completions: row.completions, shares: row.shares })),
      topContent: top.map(row => ({
        id: row._id.contentId,
        type: row._id.contentType,
        title: titles.get(row._id.contentId.toString()) ?? 'Untitled content',
        uniqueViewers: row.uniqueViewers,
        watchHours: Number((row.watchSeconds / 3600).toFixed(1)),
        completions: row.completions,
        shares: row.shares,
        completionRate: row.playStarts > 0 ? Number(((row.completions / row.playStarts) * 100).toFixed(1)) : 0,
      })),
    }
  }

  static adminReport = async (filters: AnalyticsReportFilters = {}) => {
    const days = Math.min(Math.max(Number(filters.days) || 30, 1), 90)
    const start = new Date(Date.now() - days * 86_400_000)
    const platform = filters.platform && filters.platform !== 'all'
      ? filters.platform
      : undefined
    const contentType = filters.contentType && filters.contentType !== 'all'
      ? filters.contentType
      : undefined
    const eventMatch: Record<string, unknown> = { occurredAt: { $gte: start } }
    if (platform) eventMatch.platform = platform
    if (contentType) eventMatch.contentType = contentType

    const eventCountsPromise = ContentAnalyticsEventModel.aggregate([
      { $match: eventMatch },
      { $group: { _id: { eventType: '$eventType', viewerKey: '$viewerKey' }, events: { $sum: 1 }, value: { $sum: '$watchedSeconds' }, buffering: { $sum: '$bufferingSeconds' }, startup: { $sum: '$startupMs' }, startupSamples: { $sum: { $cond: [{ $gt: ['$startupMs', 0] }, 1, 0] } } } },
      { $group: { _id: '$_id.eventType', events: { $sum: '$events' }, uniqueViewers: { $sum: 1 }, value: { $sum: '$value' }, buffering: { $sum: '$buffering' }, startup: { $sum: '$startup' }, startupSamples: { $sum: '$startupSamples' } } },
    ])

    const trendPromise = AnalyticsActiveViewerDayModel.aggregate([
      { $match: { day: { $gte: utcDay(start) }, ...(platform ? { platform } : {}) } },
      { $group: { _id: '$day', activeUsers: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])

    const topContentPromise = ContentAnalyticsEventModel.aggregate([
      { $match: { ...eventMatch, contentId: { $exists: true } } },
      {
        $group: {
          _id: { contentId: '$contentId', contentType: '$contentType' },
          viewers: { $addToSet: '$viewerKey' },
          playStarts: { $sum: { $cond: [{ $eq: ['$eventType', 'play_start'] }, 1, 0] } },
          watchSeconds: { $sum: { $cond: [{ $eq: ['$eventType', 'progress'] }, '$watchedSeconds', 0] } },
          completions: { $sum: { $cond: [{ $eq: ['$eventType', 'complete'] }, 1, 0] } },
          shares: { $sum: { $cond: [{ $eq: ['$eventType', 'share'] }, 1, 0] } },
          playbackErrors: { $sum: { $cond: [{ $eq: ['$eventType', 'playback_error'] }, 1, 0] } },
          bufferingSeconds: { $sum: { $cond: [{ $eq: ['$eventType', 'buffer'] }, '$bufferingSeconds', 0] } },
        },
      },
      { $addFields: { uniqueViewers: { $size: '$viewers' } } },
      { $sort: { watchSeconds: -1, uniqueViewers: -1 } },
      { $limit: 25 },
      { $project: { viewers: 0 } },
    ])

    const adPromise = ContentAnalyticsEventModel.aggregate([
      { $match: { ...eventMatch, eventType: { $in: ['house_ad_impression', 'house_ad_click'] }, adId: { $exists: true } } },
      { $group: { _id: '$adId', impressions: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_impression'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_click'] }, 1, 0] } } } },
      { $sort: { impressions: -1 } },
    ])

    const searchPromise = ContentAnalyticsEventModel.aggregate([
      { $match: { ...eventMatch, eventType: 'search', searchTerm: { $type: 'string', $ne: '' } } },
      { $group: { _id: { $toLower: '$searchTerm' }, searches: { $sum: 1 }, viewers: { $addToSet: '$viewerKey' } } },
      { $project: { term: '$_id', searches: 1, uniqueViewers: { $size: '$viewers' }, _id: 0 } },
      { $sort: { searches: -1 } },
      { $limit: 20 },
    ])

    const releasePromise = ContentAnalyticsEventModel.aggregate([
      { $match: eventMatch },
      {
        $group: {
          _id: { platform: '$platform', appVersion: '$appVersion' },
          viewers: { $addToSet: '$viewerKey' },
          sessions: { $addToSet: '$sessionId' },
          playStarts: { $sum: { $cond: [{ $eq: ['$eventType', 'play_start'] }, 1, 0] } },
          playbackErrors: { $sum: { $cond: [{ $eq: ['$eventType', 'playback_error'] }, 1, 0] } },
          bufferEvents: { $sum: { $cond: [{ $eq: ['$eventType', 'buffer'] }, 1, 0] } },
          startupMs: { $sum: { $cond: [{ $eq: ['$eventType', 'playback_ready'] }, '$startupMs', 0] } },
          startupSamples: { $sum: { $cond: [{ $and: [{ $eq: ['$eventType', 'playback_ready'] }, { $gt: ['$startupMs', 0] }] }, 1, 0] } },
        },
      },
      { $project: { platform: { $ifNull: ['$_id.platform', 'unknown'] }, appVersion: { $ifNull: ['$_id.appVersion', 'unknown'] }, users: { $size: '$viewers' }, sessions: { $size: '$sessions' }, playStarts: 1, playbackErrors: 1, bufferEvents: 1, averageStartupMs: { $cond: [{ $gt: ['$startupSamples', 0] }, { $round: [{ $divide: ['$startupMs', '$startupSamples'] }, 0] }, 0] }, _id: 0 } },
      { $sort: { users: -1 } },
    ])

    const paymentPromise = PaymentModel.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: { status: '$status', useCase: '$useCase', currency: '$currency' }, count: { $sum: 1 }, amount: { $sum: '$amount' }, payers: { $addToSet: '$userId' } } },
      { $project: { status: '$_id.status', useCase: '$_id.useCase', currency: '$_id.currency', count: 1, amount: 1, uniquePayers: { $size: '$payers' }, _id: 0 } },
    ])

    const registrationPromise = UserModel.aggregate([
      { $match: { role: 'customer', createdAt: { $gte: start }, deleted: { $ne: true } } },
      { $group: { _id: '$gender', count: { $sum: 1 } } },
    ])

    const retentionFor = (offsetDays: number) =>
      AnalyticsIdentityModel.aggregate([
        { $match: { firstSeenAt: { $gte: start, $lte: new Date(Date.now() - offsetDays * 86_400_000) } } },
        { $project: { viewerKey: 1, cohortDay: { $dateTrunc: { date: '$firstSeenAt', unit: 'day' } } } },
        {
          $lookup: {
            from: AnalyticsActiveViewerDayModel.collection.name,
            let: { key: '$viewerKey', target: { $dateAdd: { startDate: '$cohortDay', unit: 'day', amount: offsetDays } } },
            pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$viewerKey', '$$key'] }, { $eq: ['$day', '$$target'] }] } } }, { $limit: 1 }],
            as: 'returnActivity',
          },
        },
        { $group: { _id: null, eligible: { $sum: 1 }, returned: { $sum: { $cond: [{ $gt: [{ $size: '$returnActivity' }, 0] }, 1, 0] } } } },
      ]).then(([row]) => ({
        days: offsetDays,
        eligible: row?.eligible ?? 0,
        returned: row?.returned ?? 0,
        rate: row?.eligible ? Number(((row.returned / row.eligible) * 100).toFixed(1)) : 0,
      }))

    const [
      eventCounts,
      trend,
      topRows,
      adRows,
      payments,
      registrations,
      topSearches,
      releases,
      returningUsers,
      activeUsers,
      retention1,
      retention7,
      retention30,
    ] = await Promise.all([
      eventCountsPromise,
      trendPromise,
      topContentPromise,
      adPromise,
      paymentPromise,
      registrationPromise,
      searchPromise,
      releasePromise,
      AnalyticsIdentityModel.countDocuments({ firstSeenAt: { $lt: start }, lastSeenAt: { $gte: start } }),
      AnalyticsIdentityModel.countDocuments({
        lastSeenAt: { $gte: start },
        ...(platform ? { platform } : {}),
      }),
      retentionFor(1),
      retentionFor(7),
      retentionFor(30),
    ])

    const counts = new Map(eventCounts.map(row => [row._id, row]))
    const topIds = topRows.map(row => row._id.contentId)
    const [videos, episodes, lives] = await Promise.all([
      VideoModel.find({ _id: { $in: topIds } }).select('title').lean(),
      EpisodeModel.find({ _id: { $in: topIds } }).select('title').lean(),
      LiveModel.find({ _id: { $in: topIds } }).select('title').lean(),
    ])
    const titles = new Map([...videos, ...episodes, ...lives].map(item => [item._id.toString(), item.title]))
    const starts = counts.get('play_start')?.events ?? 0
    const completions = counts.get('complete')?.events ?? 0
    const startup = counts.get('playback_ready')
    const adIds = adRows.map(row => row._id)
    const ads = await AdModel.find({ _id: { $in: adIds } }).select('title brand').lean()
    const adNames = new Map(ads.map(ad => [ad._id.toString(), `${ad.title} — ${ad.brand}`]))
    const successfulPayments = payments.filter(row => row.status === 'success')

    return {
      filters: { days, platform: platform ?? 'all', contentType: contentType ?? 'all' },
      audience: {
        activeUsers,
        returningUsers,
        registrations: registrations.reduce((total, row) => total + row.count, 0),
        registrationsByGender: registrations.map(row => ({ gender: row._id ?? 'unspecified', count: row.count })),
        retention: [retention1, retention7, retention30],
      },
      engagement: {
        playStarts: starts,
        completions,
        completionRate: starts ? Number(((completions / starts) * 100).toFixed(1)) : 0,
        watchHours: Number(((counts.get('progress')?.value ?? 0) / 3600).toFixed(1)),
        shares: counts.get('share')?.events ?? 0,
        searches: counts.get('search')?.events ?? 0,
        downloads: counts.get('download_complete')?.events ?? 0,
        casts: counts.get('cast_start')?.events ?? 0,
        notificationOpens: counts.get('notification_open')?.events ?? 0,
      },
      playback: {
        errors: counts.get('playback_error')?.events ?? 0,
        errorRate: starts ? Number((((counts.get('playback_error')?.events ?? 0) / starts) * 100).toFixed(1)) : 0,
        bufferEvents: counts.get('buffer')?.events ?? 0,
        bufferingMinutes: Number(((counts.get('buffer')?.buffering ?? 0) / 60).toFixed(1)),
        averageStartupMs: startup?.startupSamples
          ? Math.round(startup.startup / startup.startupSamples)
          : 0,
      },
      funnel: ['content_impression', 'content_select', 'preview_start', 'play_start', 'complete'].map(eventType => ({
        eventType,
        users: counts.get(eventType)?.uniqueViewers ?? 0,
        events: counts.get(eventType)?.events ?? 0,
      })),
      trend: trend.map(row => ({ day: row._id, activeUsers: row.activeUsers })),
      topContent: topRows.map(row => ({
        id: row._id.contentId,
        type: row._id.contentType,
        title: titles.get(row._id.contentId.toString()) ?? 'Untitled content',
        uniqueViewers: row.uniqueViewers,
        playStarts: row.playStarts,
        watchHours: Number((row.watchSeconds / 3600).toFixed(1)),
        completions: row.completions,
        completionRate: row.playStarts ? Number(((row.completions / row.playStarts) * 100).toFixed(1)) : 0,
        shares: row.shares,
        playbackErrors: row.playbackErrors,
        bufferingMinutes: Number((row.bufferingSeconds / 60).toFixed(1)),
      })),
      revenue: {
        attempts: payments.reduce((total, row) => total + row.count, 0),
        successes: successfulPayments.reduce((total, row) => total + row.count, 0),
        failures: payments.filter(row => ['failed', 'abandoned', 'reversed'].includes(row.status)).reduce((total, row) => total + row.count, 0),
        byStatusAndUseCase: payments,
        revenueByCurrency: Array.from(successfulPayments.reduce((map: Map<string, number>, row) => {
          map.set(row.currency, (map.get(row.currency) ?? 0) + row.amount)
          return map
        }, new Map<string, number>()).entries()).map(([currency, amount]) => ({ currency, amount })),
      },
      houseAds: adRows.map(row => ({
        id: row._id,
        title: adNames.get(row._id.toString()) ?? 'Unknown ad',
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: row.impressions ? Number(((row.clicks / row.impressions) * 100).toFixed(2)) : 0,
      })),
      topSearches,
      releases: releases.map(row => ({
        ...row,
        errorRate: row.playStarts
          ? Number(((row.playbackErrors / row.playStarts) * 100).toFixed(1))
          : 0,
      })),
    }
  }
}
