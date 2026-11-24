import mongoose from 'mongoose'
import env from '../env'
import { VideoModel } from '../models/videos.model'
import { LiveModel } from '../models/lives.model'

const run = async () => {
  if (!env.MONGO_DB_URL) throw new Error('MONGO_DB_URL is required')
  await mongoose.connect(env.MONGO_DB_URL, { dbName: env.MONGO_DB_NAME })
  const originals = await VideoModel.collection.updateMany(
    { vidClass: 'exclusive' },
    { $set: { vidClass: 'premium', isReeplayOriginal: true }, $unset: { amount: '', currency: '' } },
  )
  const ads = await VideoModel.collection.updateMany(
    { vidClass: 'ad' },
    { $set: { vidClass: 'free', isReeplayOriginal: false }, $unset: { amount: '', currency: '' } },
  )
  await VideoModel.collection.updateMany(
    { vidClass: { $in: ['free', 'premium'] }, isReeplayOriginal: { $exists: false } },
    { $set: { isReeplayOriginal: false }, $unset: { amount: '', currency: '' } },
  )
  const live = await LiveModel.collection.updateMany(
    { vidClass: { $in: ['exclusive', 'ad'] } },
    { $set: { vidClass: 'premium' }, $unset: { amount: '', currency: '' } },
  )
  console.info({ originals: originals.modifiedCount, ads: ads.modifiedCount, live: live.modifiedCount })
  await mongoose.disconnect()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
