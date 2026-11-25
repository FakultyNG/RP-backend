import { PlatformSettingsService } from '../../services/core/PlatformSettingsService'
import { Catch } from '../../utils/Catch'
import { sendResponse } from '../../utils/responder'
import { GetDefined } from '../../utils/GetDefined'
import { OperationalError } from '../../utils/OperationalError'

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

  static getLiveAccess = Catch.async(async (_, res) => {
    sendResponse({
      res,
      data: await PlatformSettingsService.getLiveAccess(),
      message: 'Live feature setting fetched',
    })
  })

  static getLiveAccessForAdmin = Catch.async(async (_, res) => {
    sendResponse({
      res,
      data: await PlatformSettingsService.getLiveAccessForAdmin(),
      message: 'Live feature setting fetched',
    })
  })

  static setLiveAccess = Catch.async(async (req, res) => {
    const currentUser = GetDefined.loggedInUser(req.user)
    sendResponse({
      res,
      data: await PlatformSettingsService.setLiveAccess(req.body.enabled, currentUser._id),
      message: req.body.enabled ? 'Live is now visible in the app' : 'Live is now hidden in the app',
    })
  })

  static requireLiveAccess = Catch.async(async (_, __, next) => {
    const { enabled } = await PlatformSettingsService.getLiveAccess()
    if (!enabled) throw new OperationalError('Live is currently unavailable', 404)
    next()
  })
}
