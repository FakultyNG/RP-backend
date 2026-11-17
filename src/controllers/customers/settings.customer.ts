import { Catch } from '../../utils/Catch'
import { GetDefined } from '../../utils/GetDefined'
import { sendResponse } from '../../utils/responder'
import { CustomerSettingsService } from '../../services/core/CustomerSettingsService'

export class CustomerSettingsController {
  static notificationPreferences = Catch.async(async ({ user, body }, res) => {
    const data = await CustomerSettingsService.setNotificationPreferences(
      GetDefined.loggedInUser(user),
      body,
    )

    sendResponse({
      res,
      data,
      message: 'notification preferences updated',
    })
  })

  static replaceInterests = Catch.async(async ({ user, body }, res) => {
    const data = await CustomerSettingsService.replaceInterests(
      GetDefined.loggedInUser(user),
      body,
    )

    sendResponse({
      res,
      data,
      message: 'interest preferences updated',
    })
  })

  static videoQuality = Catch.async(async ({ user, body: { video_quality } }, res) => {
    const data = await CustomerSettingsService.setVideoQuality(
      GetDefined.loggedInUser(user),
      video_quality,
    )

    sendResponse({
      res,
      data,
      message: 'video quality updated',
    })
  })

  static notificationSettings = Catch.async(async ({ user, body }, res) => {
    await CustomerSettingsService.setNotificationSettings(GetDefined.loggedInUser(user), body)

    sendResponse({
      res,
      message: 'notification settings edited',
    })
  })

  static addToWatchList = Catch.async(async ({ user, body: { vid_id } }, res) => {
    await CustomerSettingsService.pushPullFromWatchlist(
      GetDefined.loggedInUser(user),
      vid_id,
      'push',
    )

    sendResponse({
      res,
      message: 'video added to watchlist',
    })
  })

  static remFromWatchList = Catch.async(async ({ user, body: { vid_id } }, res) => {
    await CustomerSettingsService.pushPullFromWatchlist(
      GetDefined.loggedInUser(user),
      vid_id,
      'pull',
    )

    sendResponse({
      res,
      message: 'video removed from watchlist',
    })
  })

  static addToInterest = Catch.async(async ({ user, body: { interest } }, res) => {
    await CustomerSettingsService.pushInterest(GetDefined.loggedInUser(user), interest)

    sendResponse({
      res,
      message: 'interest added to list',
    })
  })
}
