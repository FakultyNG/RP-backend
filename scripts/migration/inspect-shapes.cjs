const { MongoClient } = require('mongodb')

const names = [
  'ads', 'cast_enums', 'category_enums', 'episodes', 'genre_enums', 'lives',
  'poster_images', 'seasons', 'sub_titles', 'trailers', 'upcomings',
  'video_uploads', 'videos',
]

async function main() {
  const client = new MongoClient(process.env.SOURCE_MONGO_URL)
  await client.connect()
  try {
    const db = client.db(process.env.SOURCE_MONGO_DB_NAME || client.options.dbName || 'reeplayDB')
    const result = {}
    for (const name of names) {
      const docs = await db.collection(name).find({}).limit(10).toArray()
      result[name] = [...new Set(docs.flatMap(document => Object.keys(document)))].sort()
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await client.close()
  }
}

main().catch(error => {
  console.error(JSON.stringify({ error: error.message }))
  process.exitCode = 1
})
