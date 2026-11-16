export const DEFAULT_USER_PROFILE_IMAGE_PATH = '/static/images/default-user-profile.webp'

export const getDefaultUserProfileImageUrl = () => {
  const configuredUrl = process.env.DEFAULT_USER_PROFILE_IMAGE_URL?.trim()
  if (configuredUrl) return configuredUrl

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
  if (railwayDomain) {
    const origin = railwayDomain.startsWith('http')
      ? railwayDomain
      : `https://${railwayDomain}`
    return `${origin.replace(/\/$/, '')}${DEFAULT_USER_PROFILE_IMAGE_PATH}`
  }

  return DEFAULT_USER_PROFILE_IMAGE_PATH
}
