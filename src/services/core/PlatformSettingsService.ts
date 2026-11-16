import { PlatformSettingsModel } from '../../models/platformSettings.model'

export class PlatformSettingsService {
  private static guestAccessCache: boolean | undefined

  static getGuestAccess = async () => {
    if (this.guestAccessCache !== undefined) return this.guestAccessCache

    const settings = await PlatformSettingsModel.findOneAndUpdate(
      { key: 'global' },
      { $setOnInsert: { guestAccessEnabled: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    this.guestAccessCache = settings.guestAccessEnabled
    return this.guestAccessCache
  }

  static setGuestAccess = async (enabled: boolean) => {
    const settings = await PlatformSettingsModel.findOneAndUpdate(
      { key: 'global' },
      { $set: { guestAccessEnabled: enabled } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    this.guestAccessCache = settings.guestAccessEnabled
    return this.guestAccessCache
  }
}
