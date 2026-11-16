import { createHash } from 'crypto'
import { Types } from 'mongoose'
import {
  analyticsContentTypes,
  analyticsEventTypes,
  ContentAnalyticsDailyModel,
  ContentAnalyticsEventModel,
  ContentAnalyticsViewerDayModel,
} from '../../models/contentAnalytics.model'
import { LiveModel } from '../../models/lives.model'
import { VideoModel } from '../../models/videos.model'

export type AnalyticsEventInput = {
  eventId: string
  sessionId: string
  contentId: string
  contentType: (typeof analyticsContentTypes)[number]
  eventType: (typeof analyticsEventTypes)[number]
  positionSeconds?: number
  durationSeconds?: number
  watchedSeconds?: number
  completionPercent?: number
  shareDestination?: string
  occurredAt?: string
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
  static viewerKey = (userId: string) =>
    createHash('sha256')
      .update(`${process.env.JWT_SECRET ?? 'reeplay-analytics'}:${userId}`)
      .digest('hex')

  static ingest = async (userId: string, events: AnalyticsEventInput[]) => {
    const viewerKey = this.viewerKey(userId)
    let accepted = 0

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

      const inserted = await ContentAnalyticsEventModel.updateOne(
        { eventId: input.eventId },
        {
          $setOnInsert: {
            ...input,
            contentId: new Types.ObjectId(input.contentId),
            viewerKey,
            occurredAt,
            day,
            durationSeconds,
            positionSeconds,
            watchedSeconds,
            completionPercent,
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

      const qualifiesAsViewer =
        input.eventType === 'complete' ||
        (input.eventType === 'progress' && (completionPercent >= 10 || positionSeconds >= 30))
      if (qualifiesAsViewer) {
        const unique = await ContentAnalyticsViewerDayModel.updateOne(
          { contentId: input.contentId, contentType: input.contentType, day, viewerKey },
          { $setOnInsert: { contentId: input.contentId, contentType: input.contentType, day, viewerKey } },
          { upsert: true },
        )
        if (unique.upsertedCount === 1) increments.uniqueViewers = 1
      }

      if (Object.keys(increments).length > 0) {
        await ContentAnalyticsDailyModel.updateOne(
          { contentId: input.contentId, contentType: input.contentType, day },
          {
            $setOnInsert: { contentId: input.contentId, contentType: input.contentType, day },
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
}
