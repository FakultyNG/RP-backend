const { MongoClient } = require('mongodb')

async function main() {
  const client = new MongoClient(process.env.DEST_MONGO_URL)
  await client.connect()
  try {
    const db = client.db(process.env.DEST_MONGO_DB_NAME || 'reeplayDB')
    const [categories, genres, casts, videos, seasons, episodes] = await Promise.all([
      db.collection('category_enums').find({}, { projection: { _id: 1 } }).toArray(),
      db.collection('genre_enums').find({}, { projection: { _id: 1 } }).toArray(),
      db.collection('cast_enums').find({}, { projection: { _id: 1 } }).toArray(),
      db.collection('videos').find({}).toArray(),
      db.collection('seasons').find({}).toArray(),
      db.collection('episodes').find({}).toArray(),
    ])
    const ids = list => new Set(list.map(item => String(item._id)))
    const categoryIds = ids(categories)
    const genreIds = ids(genres)
    const castIds = ids(casts)
    const videoIds = ids(videos)
    const seasonIds = ids(seasons)
    const dangling = {
      categories: videos.reduce((n, item) => n + (item.category || []).filter(id => !categoryIds.has(String(id))).length, 0),
      genres: videos.reduce((n, item) => n + (item.genre || []).filter(id => !genreIds.has(String(id))).length, 0),
      casts: videos.reduce((n, item) => n + (item.cast || []).filter(id => !castIds.has(String(id))).length, 0),
    }
    let repairedVideos = 0
    if (process.argv.includes('--repair-taxonomy')) {
      for (const video of videos) {
        const category = (video.category || []).filter(id => categoryIds.has(String(id)))
        const genre = (video.genre || []).filter(id => genreIds.has(String(id)))
        const cast = (video.cast || []).filter(id => castIds.has(String(id)))
        if (category.length !== (video.category || []).length || genre.length !== (video.genre || []).length || cast.length !== (video.cast || []).length) {
          await db.collection('videos').updateOne({ _id: video._id }, { $set: { category, genre, cast } })
          repairedVideos += 1
        }
      }
    }
    const report = {
      videos: videos.length,
      danglingCategoryReferences: dangling.categories,
      danglingGenreReferences: dangling.genres,
      danglingCastReferences: dangling.casts,
      orphanSeasons: seasons.filter(item => !videoIds.has(String(item.video))).length,
      orphanEpisodes: episodes.filter(item => !seasonIds.has(String(item.season))).length,
      repairedVideos,
    }
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await client.close()
  }
}

main().catch(error => {
  console.error(JSON.stringify({ error: error.message }))
  process.exitCode = 1
})
