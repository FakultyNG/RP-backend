import assert from 'node:assert/strict'
import { addLiveSchema } from '../build/src/validations/admin.js'

const objectId = '507f1f77bcf86cd799439011'
const image = { fieldname: 'coverPhoto', mimetype: 'image/webp' }
const video = { fieldname: 'previewVideo', mimetype: 'video/mp4' }
const base = {
  clientId: objectId,
  creatorType: 'admin',
  title: 'Live contract check',
  pg: '13+',
  start: '2026-12-01T10:00:00.000Z',
  expiry: '2026-12-01T12:00:00.000Z',
  coverPhoto: image,
  category: [objectId],
  description: 'A scheduled live programme',
  vidClass: 'free',
  location: 'Lagos, Nigeria',
}

for (const type of ['event', 'tvshow', 'podcast', 'sport']) {
  const { error } = addLiveSchema.validate({ ...base, type, previewVideo: video })
  assert.equal(error, undefined, `${type} should satisfy the Live creation contract`)
}

assert.equal(
  addLiveSchema.validate({ ...base, type: 'channel', channelLogo: image }).error,
  undefined,
  'channel should accept its logo without requiring a trailer',
)

assert.ok(
  addLiveSchema.validate({ ...base, type: 'event', previewVideo: video, category: ['Live'] }).error,
  'category names must be rejected in favor of MongoDB IDs',
)

assert.ok(
  addLiveSchema.validate({ ...base, type: 'event', previewVideo: video, vidClass: 'exclusive' })
    .error,
  'exclusive Live content must require currency and amount',
)

assert.equal(
  addLiveSchema.validate({
    ...base,
    type: 'event',
    previewVideo: video,
    vidClass: 'exclusive',
    currency: 'NGN',
    amount: 2500,
  }).error,
  undefined,
  'exclusive Live content should accept a valid price',
)

console.log('Live creation contract verified for channel, event, tvshow, podcast, and sport.')
