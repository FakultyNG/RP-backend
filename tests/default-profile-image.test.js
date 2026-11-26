const {
  DEFAULT_USER_PROFILE_IMAGE_PATH,
  getDefaultUserProfileImageUrl,
} = require('../build/src/utils/defaultUserProfileImage')

describe('default user profile image', () => {
  const originalConfiguredUrl = process.env.DEFAULT_USER_PROFILE_IMAGE_URL
  const originalPublicMediaOrigin = process.env.PUBLIC_MEDIA_ORIGIN

  afterEach(() => {
    if (originalConfiguredUrl === undefined) delete process.env.DEFAULT_USER_PROFILE_IMAGE_URL
    else process.env.DEFAULT_USER_PROFILE_IMAGE_URL = originalConfiguredUrl

    if (originalPublicMediaOrigin === undefined) delete process.env.PUBLIC_MEDIA_ORIGIN
    else process.env.PUBLIC_MEDIA_ORIGIN = originalPublicMediaOrigin
  })

  test('uses the branded media origin for existing and newly-created accounts', () => {
    delete process.env.DEFAULT_USER_PROFILE_IMAGE_URL
    process.env.PUBLIC_MEDIA_ORIGIN = 'https://media.example.com'

    expect(getDefaultUserProfileImageUrl()).toBe(
      `https://media.example.com${DEFAULT_USER_PROFILE_IMAGE_PATH}`,
    )
  })

  test('supports an explicit image URL for future hosting changes', () => {
    process.env.DEFAULT_USER_PROFILE_IMAGE_URL = 'https://cdn.example.com/users/default.webp'

    expect(getDefaultUserProfileImageUrl()).toBe(
      'https://cdn.example.com/users/default.webp',
    )
  })
})
