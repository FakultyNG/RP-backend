import { InferSchemaType, Schema, model } from 'mongoose'

export const analyticsContentTypes = ['vod', 'episode', 'live'] as const
export const analyticsEventTypes = ['play_start', 'progress', 'complete', 'share'] as const

const analyticsEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    sessionId: { type: String, required: true, index: true },
    viewerKey: { type: String, required: true },
    contentId: { type: Schema.Types.ObjectId, required: true, index: true },
    contentType: { type: String, enum: analyticsContentTypes, required: true },
    eventType: { type: String, enum: analyticsEventTypes, required: true },
    positionSeconds: { type: Number, min: 0, default: 0 },
    durationSeconds: { type: Number, min: 0, default: 0 },
    watchedSeconds: { type: Number, min: 0, max: 60, default: 0 },
    completionPercent: { type: Number, min: 0, max: 100, default: 0 },
    shareDestination: { type: String, maxlength: 40 },
    occurredAt: { type: Date, required: true },
    day: { type: Date, required: true },
  },
  { timestamps: true },
)

analyticsEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })
analyticsEventSchema.index({ contentId: 1, contentType: 1, occurredAt: -1 })

const dailyAnalyticsSchema = new Schema(
  {
    contentId: { type: Schema.Types.ObjectId, required: true },
    contentType: { type: String, enum: analyticsContentTypes, required: true },
    day: { type: Date, required: true },
    playStarts: { type: Number, default: 0 },
    uniqueViewers: { type: Number, default: 0 },
    watchSeconds: { type: Number, default: 0 },
    completions: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    durationSecondsTotal: { type: Number, default: 0 },
    durationSamples: { type: Number, default: 0 },
  },
  { timestamps: true },
)

dailyAnalyticsSchema.index(
  { contentId: 1, contentType: 1, day: 1 },
  { unique: true, name: '_contentAnalyticsPerDay' },
)
dailyAnalyticsSchema.index({ day: -1 })

const viewerDaySchema = new Schema(
  {
    contentId: { type: Schema.Types.ObjectId, required: true },
    contentType: { type: String, enum: analyticsContentTypes, required: true },
    day: { type: Date, required: true },
    viewerKey: { type: String, required: true },
  },
  { timestamps: true },
)

viewerDaySchema.index(
  { contentId: 1, contentType: 1, day: 1, viewerKey: 1 },
  { unique: true, name: '_uniqueContentViewerPerDay' },
)
viewerDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 })

export const ContentAnalyticsEventModel = model('content_analytics_events', analyticsEventSchema)
export const ContentAnalyticsDailyModel = model('content_analytics_daily', dailyAnalyticsSchema)
export const ContentAnalyticsViewerDayModel = model('content_analytics_viewer_days', viewerDaySchema)

export type ContentAnalyticsEvent = InferSchemaType<typeof analyticsEventSchema>
export type ContentAnalyticsDaily = InferSchemaType<typeof dailyAnalyticsSchema>
