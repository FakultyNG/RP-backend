import env from '../env'
import { LiveModel } from '../models/lives.model'
import { OperationalError } from './OperationalError'
import { genRandUniqId } from './strGen'
import { validCurrencies, ValidCurrency } from './currency'
import { Notification } from '../notifications/notification'

interface CalculateEventChargesParams {
  start: string
  expiry: string
  currency: ValidCurrency
}

export const checkedValidLivestreamByStreamKey = async (streamKey: string) => {
  const now = new Date()

  const liveDocument = await LiveModel.findOne({ stream_key: streamKey })
    .select('start expiry title coverPhoto active')

  if (liveDocument == null) {
    throw new OperationalError(`Stream key: ${streamKey} is invalid`, 404)
  }

  if (liveDocument.expiry < now) {
    throw new OperationalError(`Stream key: ${streamKey} belongs to an expired event`, 400)
  }

  const earlyPublishWindowMs = 15 * 60 * 1000
  if (liveDocument.start.getTime() - now.getTime() > earlyPublishWindowMs) {
    throw new OperationalError('This event can only be published within 15 minutes of its start', 400)
  }

  return liveDocument
}

export const handleRTMPStreamPublish = async (streamKey: unknown) => {
  if (typeof streamKey !== 'string') {
    throw new OperationalError('Expected a stream key - Got: ' + streamKey, 404)
  }

  const liveDocument = await checkedValidLivestreamByStreamKey(streamKey)
  const liveId = liveDocument._id.toString()
  const image =
    liveDocument.coverPhoto && `${env.CDN_IMAGES_BASE_URL}/${liveDocument.coverPhoto.Key}`

  await LiveModel.findByIdAndUpdate(liveDocument._id, {
    $set: {
      active: true,
      expired: false,
      upcoming: false,
      publishedAt: new Date(),
      endedAt: null,
    },
  })

  await Notification.sendTopicPushNotification(Notification.makeContentTopic(liveId, 'LIVE'), {
    title: 'Update',
    type: 'LIVE_EVENT_REMINDER',
    body: `It's LIVE now: ${liveDocument.title} Tap to Join`,
    image,
    metadata: { liveId },
  }, true)
}

export const handleRTMPStreamPublishDone = async (streamKey: unknown) => {
  if (typeof streamKey !== 'string') {
    throw new OperationalError('Expected a stream key', 400)
  }

  const now = new Date()
  const liveDocument = await LiveModel.findOneAndUpdate(
    { stream_key: streamKey },
    [
      {
        $set: {
          active: false,
          active_views: 0,
          endedAt: now,
          expired: { $lte: ['$expiry', now] },
        },
      },
    ],
    { new: true },
  )

  if (liveDocument == null) {
    throw new OperationalError(`Stream key: ${streamKey} is invalid`, 404)
  }
}

export const getUniqueStreamKey = async (triesCount = 1): Promise<string> => {
  if (triesCount >= 5) {
    throw new OperationalError('Please try again', 500)
  }

  const streamId = genRandUniqId(12)

  const streamIdExist = await LiveModel.findOne({
    stream_key: streamId,
  })

  if (streamIdExist) {
    return await getUniqueStreamKey(++triesCount)
  }

  return streamId
}

export const getChargesFromEnv = (currency: ValidCurrency) => {
  if (!validCurrencies.includes(currency)) {
    throw new OperationalError(`Supported currencies are ${validCurrencies.join(' || ')}`, 400)
  }

  return currency === 'NGN' ? env.EVENT_HOURLY_CHARGES_NGN : env.EVENT_HOURLY_CHARGES_USD
}

export const calcLiveCharges = ({ start, expiry, currency }: CalculateEventChargesParams) => {
  const startDate = new Date(start)
  const expiryDate = new Date(expiry)

  if (!(startDate instanceof Date)) {
    throw new OperationalError('invalid start date string to calculate live charges', 400)
  }

  if (!(expiryDate instanceof Date)) {
    throw new OperationalError('invalid expiry date string to calculate live charges', 400)
  }

  const hoursDifference = (expiryDate.getTime() - startDate.getTime()) / (60 * 60000)
  const charge = hoursDifference * getChargesFromEnv(currency)
  return charge
}
