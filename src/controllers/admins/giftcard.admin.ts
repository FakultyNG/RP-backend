import { GiftCardService } from '../../services/core/GiftCardService'
import { Catch } from '../../utils/Catch'
import { GetDefined } from '../../utils/GetDefined'
import { sendResponse } from '../../utils/responder'
import { PlatformSettingsService } from '../../services/core/PlatformSettingsService'

export class AdminGiftCardController {
  static create = Catch.async(async ({ body: { amount, currency }, user }, res) => {
    const card = await GiftCardService.create({
      currentAdmin: GetDefined.loggedInUser(user),
      currency,
      amount,
    })

    sendResponse({
      res,
      message: 'gift card created',
      data: card,
    })
  })

  static fetch = Catch.async(async ({ query }, res) => {
    const cards = await GiftCardService.fetch(query)

    sendResponse({
      res,
      message: 'gift cards fetched successfully',
      data: cards,
    })
  })

  static activate = Catch.async(async ({ params }, res) => {
    await GiftCardService.activate(params.code, params.token)

    sendResponse({
      res,
      message: 'activated',
    })
  })

  static activateSecurely = Catch.async(async ({ params, body }, res) => {
    await GiftCardService.activate(params.code, body.authorizationCode)
    sendResponse({ res, message: 'Gift card activated' })
  })

  static getAuthorizationCodeStatus = Catch.async(async (_, res) => {
    sendResponse({
      res,
      message: 'Gift card authorization code status fetched',
      data: { configured: await PlatformSettingsService.hasGiftCardAuthorizationCode() },
    })
  })

  static changeAuthorizationCode = Catch.async(async ({ body }, res) => {
    await PlatformSettingsService.setGiftCardAuthorizationCode(body.newCode)
    sendResponse({ res, message: 'Gift card authorization code changed' })
  })

  static deleteById = Catch.async(async ({ params }, res) => {
    await GiftCardService.deleteById(params.id)

    sendResponse({
      res,
    })
  })

  static merchantNotifyIsUsed = Catch.async(async ({ params }, res) => {
    await GiftCardService.setMerchactCardIsUsed(params.code, params.email, params.password)

    sendResponse({
      res,
    })
  })

  static getMerchantCards = Catch.async(async ({ params, query }, res) => {
    const cards = await GiftCardService.getMerchantCards({
      query,
      currency: params.currency,
      merchantEmail: params.email,
      merchantPassword: params.password,
    })

    sendResponse({
      res,
      data: cards,
    })
  })

  static createMerchant = Catch.async(async ({ body }, res) => {
    await GiftCardService.createMerchant(body.email, body.password)

    sendResponse({
      res,
      message: 'Success',
    })
  })
}
