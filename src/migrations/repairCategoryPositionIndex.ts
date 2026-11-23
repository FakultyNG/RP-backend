import mongoose from 'mongoose'

const LEGACY_POSITION_INDEX = 'position_1'
const PLACEMENT_POSITION_INDEX = 'location_1_position_1'

export const repairCategoryPositionIndex = async () => {
  const categories = mongoose.connection.collection('category_enums')
  const indexes = await categories.indexes()

  if (indexes.some(index => index.name === LEGACY_POSITION_INDEX)) {
    await categories.dropIndex(LEGACY_POSITION_INDEX)
  }

  if (!indexes.some(index => index.name === PLACEMENT_POSITION_INDEX)) {
    await categories.createIndex(
      { location: 1, position: 1 },
      { unique: true, name: PLACEMENT_POSITION_INDEX },
    )
  }
}
