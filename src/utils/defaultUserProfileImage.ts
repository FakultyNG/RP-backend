export const DEFAULT_USER_PROFILE_IMAGE_PATH = '/static/images/default-user-profile.webp'

export const getDefaultUserProfileImageUrl = () => {
  const configuredUrl = process.env.DEFAULT_USER_PROFILE_IMAGE_URL?.trim()
  if (configuredUrl) return configuredUrl

  const origin = (
    process.env.PUBLIC_MEDIA_ORIGIN ??
    process.env.PUBLIC_API_ORIGIN ??
    process.env.PUBLIC_APP_ORIGIN ??
    'https://api.reeplay.app'
  ).replace(/\/$/, '')
  return `${origin}${DEFAULT_USER_PROFILE_IMAGE_PATH}`
}
