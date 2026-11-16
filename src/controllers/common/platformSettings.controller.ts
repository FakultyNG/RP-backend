import { PlatformSettingsService } from '../../services/core/PlatformSettingsService'
import { Catch } from '../../utils/Catch'
import { sendResponse } from '../../utils/responder'

export class PlatformSettingsController {
  static getGuestAccess = Catch.async(async (_, res) => {
    sendResponse({
      res,
      data: { enabled: await PlatformSettingsService.getGuestAccess() },
      message: 'Guest access setting fetched',
    })
  })

  static setGuestAccess = Catch.async(async ({ body }, res) => {
    sendResponse({
      res,
      data: { enabled: await PlatformSettingsService.setGuestAccess(body.enabled) },
      message: 'Guest access setting updated',
    })
  })
}
