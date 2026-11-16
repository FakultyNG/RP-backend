import { Server } from 'socket.io'
import mongoose from 'mongoose'
import { createServer } from 'node:http'

import env from './env'
import { reeplayApp } from './app'
import { Assets } from './utils/Assets'
import { FileHandler } from './utils/FileHandler'
import { connectMongoDB } from './utils/connectDB'
import { socketChat } from './socket/socketEvents'
import { purgeOldTempMediaFiles } from './utils/purgeOldTempMediaFiles'
import { WithWorkerThread } from './utils/WithWorkerThread'
import { dropLegacyCustomerPhoneIndex } from './migrations/dropLegacyCustomerPhoneIndex'
import { reconcileViewAnalytics } from './migrations/reconcileViewAnalytics'
import { repairNegativeWalletBalances } from './migrations/repairNegativeWalletBalances'

const { PORT } = env

const app = reeplayApp()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*' },
})

const makeMediaDirectories = () => {
  Object.values(Assets.rootMediaDirs).forEach(dir => FileHandler.createDirIfNotExistSync(dir))
}

makeMediaDirectories()

connectMongoDB().then(async conn => {
  console.log(conn)
  httpServer.listen(PORT, async () => {
    console.log(`Node Server Listening on port: ${PORT} >>>>>> [http://localhost:${PORT}]`)

    socketChat(io)
    console.log('Sockets initited successfully')
    if (env.ENABLE_CRON) {
      await WithWorkerThread.manageJobs('START')
    } else {
      console.log('Cron jobs disabled for this service')
    }
    setInterval(() => purgeOldTempMediaFiles(), 600000) // every ten minutes
  })

  // Maintenance must not hold the HTTP health endpoint offline. Railway can
  // replace the previous healthy deployment as soon as the API is listening,
  // while idempotent repairs continue safely in the background.
  void (async () => {
    try {
      await dropLegacyCustomerPhoneIndex()
      await repairNegativeWalletBalances()
      await reconcileViewAnalytics({ ensureIndexes: true })
    } catch (error) {
      console.error('Startup maintenance failed; API remains available', error)
    }
  })()
})

httpServer.on('close', async () => {
  console.error('reeplay server is closed: ..... 😢😢......')
  process.exit()
})

// do not handle SIGKILL and SIGSTOP
process
  .on('uncaughtException', shutdown('uncaughtException'))
  .on('unhandledRejection', shutdown('unhandledRejection'))

function shutdown(exception: string) {
  return async (...args: any[]) => {
    setTimeout(() => process.exit(1), 400).unref()
    console.error('Server shutdown routine initiated for exception >>>> 🛑', exception)

    args.forEach(arg => console.error(arg.message ?? arg))

    console.error('Reasons >>>> 🛑:', args.join(' | '))

    // *********** clean up
    io.close()
    console.log('IO Websocket closed')

    if (env.ENABLE_CRON) {
      await WithWorkerThread.manageJobs('STOP')
    }
    await mongoose.connection.close(true)
    console.log('Mongoose connection closed')
    httpServer.close()
  }
}
