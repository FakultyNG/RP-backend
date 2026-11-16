import mongoose from 'mongoose'

const LEGACY_PHONE_INDEX = 'country_code_1_mobile_1'

/**
 * Removes the legacy uniqueness constraint now that phone numbers are no
 * longer collected during customer registration. This is safe to run on
 * every startup and only targets the exact historical index name.
 */
export const dropLegacyCustomerPhoneIndex = async () => {
  const users = mongoose.connection.collection('users')
  const indexes = await users.indexes()

  if (indexes.some(index => index.name === LEGACY_PHONE_INDEX)) {
    await users.dropIndex(LEGACY_PHONE_INDEX)
    console.log(`Dropped legacy users index: ${LEGACY_PHONE_INDEX}`)
  }
}
