import { AnalyticsService } from '../../services/core/AnalyticsService'
import { Catch } from '../../utils/Catch'
import { sendResponse } from '../../utils/responder'
import { guranteeNumericResult } from '../../utils/QueryParamsFeatures'

export class AdminAnalyticsController {
  static overview = Catch.async(async ({ query }, res) => {
    const data = await AnalyticsService.adminOverview(guranteeNumericResult(query.days, 7))
    sendResponse({ res, data, message: 'Content analytics fetched successfully' })
  })
}
