const { contentAnalyticsSchema } = require('../build/src/validations/customers')

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
})
