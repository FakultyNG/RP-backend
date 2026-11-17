import { PlatformSettingsModel } from '../../models/platformSettings.model'
import { Password } from '../../utils/Password'

// High-entropy one-time bootstrap credential. Rotate it from Super Admin Settings.
const GIFT_CARD_BOOTSTRAP_CODE_HASH =
  '$2b$12$5njQWZeFGesA5xgx/pQE..iVKukVKqUp2iGSjjQ3lJo3BiWpVYbPC'

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

  private static getGiftCardAuthorizationCodeHash = async () => {
    let settings = await PlatformSettingsModel.findOneAndUpdate(
      { key: 'global' },
      { $setOnInsert: { guestAccessEnabled: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).select('+giftCardAuthorizationCodeHash')

    if (!settings.giftCardAuthorizationCodeHash) {
      await PlatformSettingsModel.updateOne(
        {
          _id: settings._id,
          $or: [
            { giftCardAuthorizationCodeHash: { $exists: false } },
            { giftCardAuthorizationCodeHash: null },
          ],
        },
        { $set: { giftCardAuthorizationCodeHash: GIFT_CARD_BOOTSTRAP_CODE_HASH } },
      )
      settings = await PlatformSettingsModel.findById(settings._id)
        .select('+giftCardAuthorizationCodeHash')
        .orFail()
    }

    return settings.giftCardAuthorizationCodeHash as string
  }

  static verifyGiftCardAuthorizationCode = async (code: string) =>
    Password.compare(code, await this.getGiftCardAuthorizationCodeHash())

  static setGiftCardAuthorizationCode = async (newCode: string) => {
    const hash = await Password.encrypt(newCode)
    await PlatformSettingsModel.findOneAndUpdate(
      { key: 'global' },
      {
        $set: { giftCardAuthorizationCodeHash: hash },
        $setOnInsert: { guestAccessEnabled: false },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  static hasGiftCardAuthorizationCode = async () => {
    await this.getGiftCardAuthorizationCodeHash()
    return true
  }
}
