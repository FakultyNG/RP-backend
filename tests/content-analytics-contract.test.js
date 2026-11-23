const {
  anonymousContentAnalyticsSchema,
  contentAnalyticsSchema,
} = require('../build/src/validations/customers')

const event = {
  eventId: 'session-1-progress-15',
  sessionId: 'session-1',
  contentId: '507f1f77bcf86cd799439011',
  contentType: 'vod',
  eventType: 'progress',
  positionSeconds: 15,
  durationSeconds: 100,
  watchedSeconds: 15,
  completionPercent: 15,
  occurredAt: '2026-11-14T00:00:00.000Z',
}

describe('content analytics ingestion contract', () => {
  test('accepts a valid privacy-safe playback event', () => {
    expect(contentAnalyticsSchema.body.validate({ events: [event] }).error).toBeUndefined()
  })

  test('rejects oversized batches and invalid completion values', () => {
    expect(
      contentAnalyticsSchema.body.validate({ events: Array.from({ length: 51 }, (_, i) => ({
        ...event,
        eventId: `event-${i}`,
      })) }).error,
    ).toBeDefined()

    expect(
      contentAnalyticsSchema.body.validate({
        events: [{ ...event, completionPercent: 101 }],
      }).error,
    ).toBeDefined()
  })

  test('accepts product events without content and requires content for playback', () => {
    const screenEvent = {
      eventId: 'screen-1',
      sessionId: 'session-1',
      eventType: 'screen_view',
      screenName: 'Home',
      occurredAt: '2026-11-14T00:00:00.000Z',
    }
    expect(contentAnalyticsSchema.body.validate({ events: [screenEvent] }).error).toBeUndefined()
    expect(
      contentAnalyticsSchema.body.validate({
        events: [{ ...screenEvent, eventType: 'play_start' }],
      }).error,
    ).toBeDefined()
  })

  test('validates anonymous installs and house-ad identifiers', () => {
    const adEvent = {
      eventId: 'ad-1',
      sessionId: 'session-1',
      eventType: 'house_ad_impression',
      adId: '507f1f77bcf86cd799439011',
    }
    expect(
      anonymousContentAnalyticsSchema.body.validate({
        installId: 'install-12345678901234567890',
        events: [adEvent],
      }).error,
    ).toBeUndefined()
    expect(
      anonymousContentAnalyticsSchema.body.validate({
        installId: 'too-short',
        events: [{ ...adEvent, adId: undefined }],
      }).error,
    ).toBeDefined()

    expect(
      anonymousContentAnalyticsSchema.body.validate({
        installId: 'install-12345678901234567890',
        events: [{ ...adEvent, eventId: 'welcome-ad-25', eventType: 'house_ad_video_25' }],
      }).error,
    ).toBeUndefined()
  })
})
