const {
  DEFAULT_USER_PROFILE_IMAGE_PATH,
  getDefaultUserProfileImageUrl,
} = require('../build/src/utils/defaultUserProfileImage')

describe('default user profile image', () => {
  const originalConfiguredUrl = process.env.DEFAULT_USER_PROFILE_IMAGE_URL
  const originalRailwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN

  afterEach(() => {
    if (originalConfiguredUrl === undefined) delete process.env.DEFAULT_USER_PROFILE_IMAGE_URL
    else process.env.DEFAULT_USER_PROFILE_IMAGE_URL = originalConfiguredUrl

    if (originalRailwayDomain === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN
    else process.env.RAILWAY_PUBLIC_DOMAIN = originalRailwayDomain
  })

  test('uses the Railway public domain for existing and newly-created accounts', () => {
    delete process.env.DEFAULT_USER_PROFILE_IMAGE_URL
    process.env.RAILWAY_PUBLIC_DOMAIN = 'reeplay-api.example.com'

    expect(getDefaultUserProfileImageUrl()).toBe(
      `https://reeplay-api.example.com${DEFAULT_USER_PROFILE_IMAGE_PATH}`,
    )
  })

  test('supports an explicit image URL for future hosting changes', () => {
    process.env.DEFAULT_USER_PROFILE_IMAGE_URL = 'https://cdn.example.com/users/default.webp'

    expect(getDefaultUserProfileImageUrl()).toBe(
      'https://cdn.example.com/users/default.webp',
    )
  })
})
