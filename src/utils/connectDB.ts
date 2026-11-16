import { connect, connection, set } from 'mongoose'
import env from '../env'

export const connectMongoDB = async (url = env.MONGO_DB_URL) => {
  if (connection.readyState === 1) {
    return 'Already Connected to MongoDB'
  }

  set('autoIndex', true)
  await connect(url, {
    dbName: env.MONGO_DB_NAME,
    // The Railway Hobby database has enough capacity to reconcile model
    // indexes. MongoDB skips indexes that already exist.
    autoIndex: true,
  })
  return 'Connected to mongoDB succesfully'
}
