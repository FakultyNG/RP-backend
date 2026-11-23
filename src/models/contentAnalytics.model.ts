import { InferSchemaType, Schema, model } from 'mongoose'

export const analyticsContentTypes = ['vod', 'episode', 'live'] as const
export const analyticsEventTypes = [
  'app_session_start',
  'screen_view',
  'content_impression',
  'content_select',
  'preview_start',
  'play_start',
  'playback_ready',
  'progress',
  'buffer',
  'playback_error',
  'complete',
  'search',
  'download_start',
  'download_complete',
  'download_error',
  'cast_start',
  'cast_complete',
  'cast_error',
  'share',
  'notification_received',
  'notification_open',
  'house_ad_impression',
  'house_ad_click',
] as const

export const analyticsPlatforms = ['android', 'ios', 'web', 'unknown'] as const
export const analyticsDeviceClasses = ['phone', 'tablet', 'tv', 'web', 'unknown'] as const

const analyticsEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    sessionId: { type: String, required: true, index: true },
    viewerKey: { type: String, required: true },
    contentId: { type: Schema.Types.ObjectId, index: true },
    contentType: { type: String, enum: analyticsContentTypes },
    eventType: { type: String, enum: analyticsEventTypes, required: true },
    positionSeconds: { type: Number, min: 0, default: 0 },
    durationSeconds: { type: Number, min: 0, default: 0 },
    watchedSeconds: { type: Number, min: 0, max: 60, default: 0 },
    completionPercent: { type: Number, min: 0, max: 100, default: 0 },
    shareDestination: { type: String, maxlength: 40 },
    screenName: { type: String, maxlength: 80 },
    sourceScreen: { type: String, maxlength: 80 },
    searchTerm: { type: String, maxlength: 100 },
    adId: { type: Schema.Types.ObjectId, index: true },
    notificationId: { type: String, maxlength: 100 },
    appVersion: { type: String, maxlength: 30 },
    platform: { type: String, enum: analyticsPlatforms, default: 'unknown' },
    osVersion: { type: String, maxlength: 40 },
    deviceClass: { type: String, enum: analyticsDeviceClasses, default: 'unknown' },
    networkType: { type: String, maxlength: 30 },
    quality: { type: String, maxlength: 20 },
    errorCode: { type: String, maxlength: 80 },
    startupMs: { type: Number, min: 0, max: 300_000 },
    bufferingSeconds: { type: Number, min: 0, max: 300 },
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
    playbackErrors: { type: Number, default: 0 },
    bufferEvents: { type: Number, default: 0 },
    bufferingSeconds: { type: Number, default: 0 },
    startupMsTotal: { type: Number, default: 0 },
    startupSamples: { type: Number, default: 0 },
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

const analyticsIdentitySchema = new Schema(
  {
    viewerKey: { type: String, required: true, unique: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    platform: { type: String, enum: analyticsPlatforms, default: 'unknown' },
    appVersion: { type: String, maxlength: 30 },
    deviceClass: { type: String, enum: analyticsDeviceClasses, default: 'unknown' },
    registered: { type: Boolean, default: false },
  },
  { timestamps: true },
)

const activeViewerDaySchema = new Schema(
  {
    viewerKey: { type: String, required: true },
    day: { type: Date, required: true },
    platform: { type: String, enum: analyticsPlatforms, default: 'unknown' },
    appVersion: { type: String, maxlength: 30 },
  },
  { timestamps: true },
)

activeViewerDaySchema.index(
  { viewerKey: 1, day: 1 },
  { unique: true, name: '_uniqueActiveViewerPerDay' },
)
activeViewerDaySchema.index({ day: -1, platform: 1, appVersion: 1 })
activeViewerDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 })

export const AnalyticsIdentityModel = model('analytics_identities', analyticsIdentitySchema)
export const AnalyticsActiveViewerDayModel = model(
  'analytics_active_viewer_days',
  activeViewerDaySchema,
)

export type ContentAnalyticsEvent = InferSchemaType<typeof analyticsEventSchema>
export type ContentAnalyticsDaily = InferSchemaType<typeof dailyAnalyticsSchema>
