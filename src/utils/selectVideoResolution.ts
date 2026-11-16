import { Resolution } from '../types/movie'

export type SupportedVideoQuality = 'automatic' | '1080p' | '720p' | '480p'

const preferredResolutions: Record<SupportedVideoQuality, string[]> = {
  automatic: ['720', '480', '1080'],
  '1080p': ['1080', '720', '480'],
  '720p': ['720', '480', '1080'],
  '480p': ['480', '720', '1080'],
}

export const selectVideoResolution = (
  resolutions: Resolution[],
  quality: SupportedVideoQuality,
) => {
  const order = preferredResolutions[quality] ?? preferredResolutions.automatic

  return order
    .map(resolution =>
      resolutions.find(item => item.resolution.startsWith(resolution)),
    )
    .find(Boolean)
}
