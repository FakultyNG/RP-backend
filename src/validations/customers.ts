import Joi from 'joi'
import { MONGO_DB_OBJECT_ID_SCHEMA, STRING_SCHEMA } from './common'

export const createCustomerSchema = {
  body: Joi.object({
    name: STRING_SCHEMA.trim().min(1).max(80).required(),
    email: STRING_SCHEMA.email().required(),
    password: STRING_SCHEMA.required(),
  }),
}

export const fetchUpcomingSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
}

export const subscriptionSchema = {
  params: Joi.object({
    id: MONGO_DB_OBJECT_ID_SCHEMA.required(),
    contentType: STRING_SCHEMA.valid('live', 'vod').required(),
  }),
}

export const isSubscribedSchema = subscriptionSchema

export const videoQualitySchema = {
  body: Joi.object({
    video_quality: STRING_SCHEMA.valid('automatic', '480p', '720p', '1080p').required(),
  }),
}

const INTEREST_IDS = Joi.array()
  .items(Joi.string().hex().length(24))
  .unique()
  .max(7)
  .default([])

export const interestPreferencesSchema = {
  body: Joi.object({
    genreIds: INTEREST_IDS,
    categoryIds: INTEREST_IDS,
  }).custom((value, helpers) => {
    if (value.genreIds.length + value.categoryIds.length > 7) {
      return helpers.error('array.max', { limit: 7 })
    }
    return value
  }),
}

export const notificationPreferencesSchema = {
  body: Joi.object({
    allow_notifications: Joi.boolean(),
    new_services: Joi.boolean(),
    upcoming_events: Joi.boolean(),
    new_arrivals: Joi.boolean(),
    live_channels: Joi.boolean(),
  }).min(1),
}

export const createCommentSchema = {
  body: Joi.object({
    message: STRING_SCHEMA.trim().min(1).max(1000).required(),
    parentType: STRING_SCHEMA.valid('vod', 'episode').required(),
    parentId: MONGO_DB_OBJECT_ID_SCHEMA.required(),
  }),
}

export const createReplySchema = {
  body: Joi.object({
    message: STRING_SCHEMA.trim().min(1).max(1000).required(),
    parentType: STRING_SCHEMA.valid('vod', 'episode').required(),
    parentId: MONGO_DB_OBJECT_ID_SCHEMA.required(),
    parentCommentId: MONGO_DB_OBJECT_ID_SCHEMA.required(),
    parentReplyId: MONGO_DB_OBJECT_ID_SCHEMA,
  }),
}

export const updateCommentSchema = {
  body: Joi.object({
    message: STRING_SCHEMA.trim().min(1).max(1000).required(),
  }),
}

export const createRatingSchema = {
  body: Joi.object({
    parentType: STRING_SCHEMA.valid('vod').required(),
    parentId: MONGO_DB_OBJECT_ID_SCHEMA.required(),
    rate: Joi.number().integer().min(1).max(5).required(),
    comment: STRING_SCHEMA.optional(),
  }),
}

export const updateRatingSchema = {
  body: Joi.object({
    comment: STRING_SCHEMA.optional(),
    rate: Joi.number().integer().min(1).max(5).optional(),
  }).or('comment', 'rate'),
}

export const viewContentSchema = {
  body: Joi.object({
    content: MONGO_DB_OBJECT_ID_SCHEMA.required(),
    contentType: STRING_SCHEMA.valid('vod', 'episode', 'live').required(),
  }),
}

const analyticsEventSchema = Joi.object({
  eventId: STRING_SCHEMA.max(120).required(),
  sessionId: STRING_SCHEMA.max(120).required(),
  contentId: MONGO_DB_OBJECT_ID_SCHEMA.when('eventType', {
    is: Joi.valid(
      'content_impression', 'content_select', 'preview_start', 'play_start',
      'playback_ready', 'progress', 'buffer', 'playback_error', 'complete',
      'download_start', 'download_complete', 'download_error', 'cast_start',
      'cast_complete', 'cast_error', 'share',
    ),
    then: Joi.required(),
  }),
  contentType: STRING_SCHEMA.valid('vod', 'episode', 'live').when('eventType', {
    is: Joi.valid(
      'content_impression', 'content_select', 'preview_start', 'play_start',
      'playback_ready', 'progress', 'buffer', 'playback_error', 'complete',
      'download_start', 'download_complete', 'download_error', 'cast_start',
      'cast_complete', 'cast_error', 'share',
    ),
    then: Joi.required(),
  }),
  eventType: STRING_SCHEMA.valid(
    'app_session_start', 'screen_view', 'content_impression', 'content_select',
    'preview_start', 'play_start', 'playback_ready', 'progress', 'buffer',
    'playback_error', 'complete', 'search', 'download_start', 'download_complete',
    'download_error', 'cast_start', 'cast_complete', 'cast_error', 'share',
    'notification_received', 'notification_open', 'house_ad_impression',
    'house_ad_click',
  ).required(),
  positionSeconds: Joi.number().min(0).max(24 * 60 * 60),
  durationSeconds: Joi.number().min(0).max(24 * 60 * 60),
  watchedSeconds: Joi.number().min(0).max(60),
  completionPercent: Joi.number().min(0).max(100),
  shareDestination: STRING_SCHEMA.max(40),
  screenName: STRING_SCHEMA.max(80),
  sourceScreen: STRING_SCHEMA.max(80),
  searchTerm: STRING_SCHEMA.max(100),
  adId: MONGO_DB_OBJECT_ID_SCHEMA.when('eventType', {
    is: Joi.valid('house_ad_impression', 'house_ad_click'),
    then: Joi.required(),
  }),
  notificationId: STRING_SCHEMA.max(100),
  appVersion: STRING_SCHEMA.max(30),
  platform: STRING_SCHEMA.valid('android', 'ios', 'web', 'unknown'),
  osVersion: STRING_SCHEMA.max(40),
  deviceClass: STRING_SCHEMA.valid('phone', 'tablet', 'tv', 'web', 'unknown'),
  networkType: STRING_SCHEMA.max(30),
  quality: STRING_SCHEMA.max(20),
  errorCode: STRING_SCHEMA.max(80),
  startupMs: Joi.number().min(0).max(300_000),
  bufferingSeconds: Joi.number().min(0).max(300),
  occurredAt: Joi.date().iso(),
}).with('contentId', 'contentType').with('contentType', 'contentId')

export const contentAnalyticsSchema = {
  body: Joi.object({
    events: Joi.array().items(analyticsEventSchema).min(1).max(50).required(),
  }),
}

export const anonymousContentAnalyticsSchema = {
  body: Joi.object({
    installId: STRING_SCHEMA.min(20).max(120).required(),
    events: Joi.array().items(analyticsEventSchema).min(1).max(50).required(),
  }),
}

export const createWatchedSchema = {
  body: Joi.object({
    parentId: MONGO_DB_OBJECT_ID_SCHEMA.required(),
    parentType: STRING_SCHEMA.valid('episode', 'vod').required(),
    duration: Joi.number().min(0).required(),
    totalDuration: Joi.number().min(0).required(),
  }),
}

export const registerRecentSearchSchema = {
  body: Joi.object({
    contentId: MONGO_DB_OBJECT_ID_SCHEMA.required(),
    contentType: STRING_SCHEMA.valid('vod', 'live').required(),
  }),
}
