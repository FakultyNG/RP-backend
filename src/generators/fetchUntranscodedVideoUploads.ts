import { VideoUploadModel } from '../models/videoupload.model'

export async function* fetchUntranscodedVideoUploadDocumentsGenerator() {
  const limit = 10
  const cursor = VideoUploadModel.find({
    isTranscoded: false,
    hlsKey: { $exists: true, $ne: null },
    hlsStatus: { $ne: 'failed' },
  })
    .sort({ _id: 1 })
    .cursor({ batchSize: limit })

  let batch = []

  try {
    for await (const document of cursor) {
      batch.push(document)
      if (batch.length === limit) {
        yield batch
        batch = []
      }
    }

    if (batch.length > 0) yield batch
  } catch (e: any) {
    console.error('fetchUntranscodedVideoUploadDocumentsGenerator error', e.message || e)
  } finally {
    await cursor.close().catch(() => undefined)
  }
}
