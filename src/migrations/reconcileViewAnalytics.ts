import mongoose from 'mongoose'
import { ContentAnalyticsDailyModel, ContentAnalyticsEventModel, ContentAnalyticsViewerDayModel } from '../models/contentAnalytics.model'
import { EpisodeModel } from '../models/episodes.model'
import { LiveViewerPresenceModel } from '../models/liveViewerPresence.model'
import { LiveModel } from '../models/lives.model'
import { SeasonModel } from '../models/seasons.model'
import { VideoModel } from '../models/videos.model'
import { ViewModel } from '../models/view.model'

const MIGRATION_ID = 'reconcile-unique-content-views-and-analytics-v1'

const removeDuplicateDocuments = async (
  collection: mongoose.mongo.Collection,
  groupId: Record<string, string>,
) => {
  const duplicates = await collection
    .aggregate([
      { $group: { _id: groupId, ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray()

  for (const duplicate of duplicates) {
    await collection.deleteMany({ _id: { $in: duplicate.ids.slice(1) } })
  }
}

const backfillSeriesParentViews = async () => {
  const episodeViews = await ViewModel.find({ contentType: 'episode' })
    .select('viewer content')
    .lean()
  if (episodeViews.length === 0) return

  const episodes = await EpisodeModel.find({
    _id: { $in: episodeViews.map(view => view.content) },
  })
    .select('_id season')
    .lean()
  const seasons = await SeasonModel.find({
    _id: { $in: episodes.map(episode => episode.season) },
  })
    .select('_id video')
    .lean()

  const seasonById = new Map(seasons.map(season => [season._id.toString(), season.video]))
  const parentByEpisode = new Map(
    episodes.flatMap(episode => {
      const parent = seasonById.get(episode.season.toString())
      return parent ? [[episode._id.toString(), parent] as const] : []
    }),
  )

  const operations = episodeViews.flatMap(view => {
    const parent = parentByEpisode.get(view.content.toString())
    if (!parent) return []
    return [
      {
        updateOne: {
          filter: { viewer: view.viewer, content: parent, contentType: 'vod' as const },
          update: { $setOnInsert: { viewer: view.viewer, content: parent, contentType: 'vod' as const } },
          upsert: true,
        },
      },
    ]
  })
  if (operations.length > 0) await ViewModel.bulkWrite(operations, { ordered: false })
}

const rebuildLegacyViewCounters = async () => {
  await Promise.all([
    VideoModel.updateMany({}, { $set: { viewsCount: 0 } }),
    EpisodeModel.updateMany({}, { $set: { viewsCount: 0 } }),
    LiveModel.updateMany({}, { $set: { viewsCount: 0, active_views: 0 } }),
    LiveViewerPresenceModel.deleteMany({}),
  ])

  const counts = await ViewModel.aggregate<{
    _id: { content: mongoose.Types.ObjectId; contentType: 'vod' | 'episode' | 'live' }
    count: number
  }>([
    { $match: { contentType: { $in: ['vod', 'episode', 'live'] } } },
    { $group: { _id: { content: '$content', contentType: '$contentType' }, count: { $sum: 1 } } },
  ])

  const operations = (type: 'vod' | 'episode' | 'live') =>
    counts
      .filter(row => row._id.contentType === type)
      .map(row => ({
        updateOne: {
          filter: { _id: row._id.content },
          update: { $set: { viewsCount: row.count } },
        },
      }))

  const [vods, episodes, lives] = [operations('vod'), operations('episode'), operations('live')]
  await Promise.all([
    vods.length ? VideoModel.bulkWrite(vods) : Promise.resolve(),
    episodes.length ? EpisodeModel.bulkWrite(episodes) : Promise.resolve(),
    lives.length ? LiveModel.bulkWrite(lives) : Promise.resolve(),
  ])
}

const rebuildEventAnalytics = async () => {
  const events = ContentAnalyticsEventModel.collection
  const daily = ContentAnalyticsDailyModel.collection
  const viewers = ContentAnalyticsViewerDayModel.collection

  await removeDuplicateDocuments(events, { eventId: '$eventId' })
  await Promise.all([daily.deleteMany({}), viewers.deleteMany({})])
  await Promise.all([
    ContentAnalyticsEventModel.createIndexes(),
    ContentAnalyticsDailyModel.createIndexes(),
    ContentAnalyticsViewerDayModel.createIndexes(),
  ])

  await events
    .aggregate([
      {
        $group: {
          _id: { contentId: '$contentId', contentType: '$contentType', day: '$day' },
          playStarts: { $sum: { $cond: [{ $eq: ['$eventType', 'play_start'] }, 1, 0] } },
          watchSeconds: { $sum: { $cond: [{ $eq: ['$eventType', 'progress'] }, '$watchedSeconds', 0] } },
          completions: { $sum: { $cond: [{ $eq: ['$eventType', 'complete'] }, 1, 0] } },
          shares: { $sum: { $cond: [{ $eq: ['$eventType', 'share'] }, 1, 0] } },
          durationSecondsTotal: { $sum: { $cond: [{ $eq: ['$eventType', 'play_start'] }, '$durationSeconds', 0] } },
          durationSamples: { $sum: { $cond: [{ $and: [{ $eq: ['$eventType', 'play_start'] }, { $gt: ['$durationSeconds', 0] }] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          contentId: '$_id.contentId',
          contentType: '$_id.contentType',
          day: '$_id.day',
          playStarts: 1,
          uniqueViewers: { $literal: 0 },
          watchSeconds: 1,
          completions: 1,
          shares: 1,
          durationSecondsTotal: 1,
          durationSamples: 1,
          createdAt: '$$NOW',
          updatedAt: '$$NOW',
        },
      },
      { $merge: { into: daily.collectionName, on: ['contentId', 'contentType', 'day'], whenMatched: 'replace', whenNotMatched: 'insert' } },
    ])
    .toArray()

  await events
    .aggregate([
      {
        $match: {
          $or: [
            { eventType: 'complete' },
            { eventType: 'progress', $or: [{ completionPercent: { $gte: 10 } }, { positionSeconds: { $gte: 30 } }] },
          ],
        },
      },
      { $group: { _id: { contentId: '$contentId', contentType: '$contentType', day: '$day', viewerKey: '$viewerKey' } } },
      {
        $project: {
          _id: 0,
          contentId: '$_id.contentId',
          contentType: '$_id.contentType',
          day: '$_id.day',
          viewerKey: '$_id.viewerKey',
          createdAt: '$$NOW',
          updatedAt: '$$NOW',
        },
      },
      { $merge: { into: viewers.collectionName, on: ['contentId', 'contentType', 'day', 'viewerKey'], whenMatched: 'keepExisting', whenNotMatched: 'insert' } },
    ])
    .toArray()

  const uniqueCounts = await viewers
    .aggregate([
      { $group: { _id: { contentId: '$contentId', contentType: '$contentType', day: '$day' }, count: { $sum: 1 } } },
    ])
    .toArray()
  if (uniqueCounts.length > 0) {
    await daily.bulkWrite(
      uniqueCounts.map(row => ({
        updateOne: {
          filter: { contentId: row._id.contentId, contentType: row._id.contentType, day: row._id.day },
          update: { $set: { uniqueViewers: row.count } },
        },
      })),
    )
  }
}

export const reconcileViewAnalytics = async (options: { ensureIndexes?: boolean } = {}) => {
  const ensureIndexes = options.ensureIndexes ?? true
  const migrations = mongoose.connection.collection('system_migrations')
  const completed = await migrations.findOne({ _id: MIGRATION_ID as any })

  if (!completed) {
    await removeDuplicateDocuments(ViewModel.collection, {
      viewer: '$viewer',
      content: '$content',
      contentType: '$contentType',
    })
    if (ensureIndexes) {
      await ViewModel.createIndexes()
    }
    await backfillSeriesParentViews()
    await rebuildLegacyViewCounters()
    await rebuildEventAnalytics()
    await migrations.insertOne({ _id: MIGRATION_ID as any, completedAt: new Date() })
    console.log('Reconciled unique content views and playback analytics')
  }

  if (ensureIndexes) {
    await Promise.all([
      ViewModel.createIndexes(),
      LiveViewerPresenceModel.createIndexes(),
      ContentAnalyticsEventModel.createIndexes(),
      ContentAnalyticsDailyModel.createIndexes(),
      ContentAnalyticsViewerDayModel.createIndexes(),
    ])
  } else {
    console.log('Skipped analytics index reconciliation; automatic production indexes are disabled')
  }
}
