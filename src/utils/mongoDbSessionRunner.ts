import { startSession, ClientSession, connection } from 'mongoose'

export type MaybeSession = ClientSession | undefined

export type Executor<T, U> = (params: T, session: MaybeSession) => Promise<U>

type MongoHelloResponse = {
  setName?: string
  msg?: string
}

let transactionSupport: Promise<boolean> | undefined

/**
 * MongoDB only supports multi-document transactions on replica sets and mongos.
 * Railway's standard Mongo service is standalone, so production mode alone is
 * not a valid signal that transactions can be used.
 */
export const supportsTransactions = async () => {
  transactionSupport ??= (async () => {
    try {
      const hello = (await connection.db?.admin().command({ hello: 1 })) as
        | MongoHelloResponse
        | undefined

      return Boolean(hello?.setName || hello?.msg === 'isdbgrid')
    } catch {
      // If topology discovery is unavailable, execute without a transaction.
      // The runner still propagates any operation error to the caller.
      return false
    }
  })()

  return transactionSupport
}

export const startTransaction = async () => {
  const session = await startSession()
  session.startTransaction()
  return session
}

export const commitSession = async (session: MaybeSession) => {
  if (session) {
    await session.commitTransaction()
    await session.endSession()
  }
}

export const abortSession = async (session: MaybeSession) => {
  if (session) {
    await session.abortTransaction()
    await session.endSession()
  }
}

export const withMongoDBSession = async <T, U>(runner: Executor<T, U>, params: T) => {
  const session = (await supportsTransactions()) ? await startTransaction() : undefined

  try {
    const res = await runner(params, session)
    await commitSession(session)
    return res
  } catch (e) {
    await abortSession(session)
    throw e
  }
}
