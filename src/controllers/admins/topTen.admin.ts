import {TopTenService} from '../../services/core/TopTenService'
import {Catch} from '../../utils/Catch'
import {sendResponse} from '../../utils/responder'

export class AdminTopTenController {
  static fetch = Catch.async(async (_req, res) => {
    sendResponse({res, data: await TopTenService.getAdmin(), message: 'Top 10 fetched'})
  })

  static replace = Catch.async(async ({body}, res) => {
    sendResponse({
      res,
      data: await TopTenService.replace(body.videoIds),
      message: 'Top 10 updated',
    })
  })

  static autoRank = Catch.async(async (_req, res) => {
    sendResponse({
      res,
      data: await TopTenService.autoRank(),
      message: 'Top 10 ranked from current engagement',
    })
  })
}
