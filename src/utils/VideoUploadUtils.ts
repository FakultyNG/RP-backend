import { Settings, SettingsModel } from '../models/userSettings.model'
import { MediaAccess } from '../services/media-access'
import { Resolution } from '../types/movie'
import { selectVideoResolution } from './selectVideoResolution'

export type VideoQuality = NonNullable<Settings['video_quality']>

export class VidUploadUtils {
  static getResSourceUrl = (
    videoUpload:
      | {
          resolutions: Resolution[]
          hlsKey?: string | null
          hlsStatus?: 'pending' | 'processing' | 'ready' | 'failed'
        }
      | undefined
      | null,
    quality: VideoQuality,
    signKey = MediaAccess.getSignedVideoURL,
  ) => {
    if (videoUpload == null) {
      return null
    }

    if (videoUpload.hlsKey && videoUpload.hlsStatus === 'ready') {
      return MediaAccess.getHlsPlaybackURL(videoUpload.hlsKey)
    }

    // Temporary migration fallback. Removed after every catalog item has a
    // verified Railway HLS master playlist and legacy downloads are handled.
    if (videoUpload.resolutions.length === 0) {
      return null
    }

    const res = selectVideoResolution(videoUpload.resolutions, quality)

    return res?.key ? signKey(res.key) : null
  }

  static getUserVideoQuality = async (
    userId: string,
    defaultQuality: VideoQuality = 'automatic',
  ) => {
    const userSetting = await SettingsModel.findOne({ user_id: userId }).sort({ _id: -1 })
    return userSetting?.video_quality ?? defaultQuality
  }
}
