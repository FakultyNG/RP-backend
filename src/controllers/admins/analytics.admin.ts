import { AnalyticsService } from '../../services/core/AnalyticsService'
import { Catch } from '../../utils/Catch'
import { sendResponse } from '../../utils/responder'
import { guranteeNumericResult } from '../../utils/QueryParamsFeatures'

export class AdminAnalyticsController {
  static overview = Catch.async(async ({ query }, res) => {
    const data = await AnalyticsService.adminOverview(guranteeNumericResult(query.days, 7))
    sendResponse({ res, data, message: 'Content analytics fetched successfully' })
  })

  static report = Catch.async(async ({ query }, res) => {
    const data = await AnalyticsService.adminReport({
      days: guranteeNumericResult(query.days, 30),
      platform: typeof query.platform === 'string' ? query.platform as any : 'all',
      contentType: typeof query.contentType === 'string' ? query.contentType as any : 'all',
    })
    sendResponse({ res, data, message: 'Analytics report fetched successfully' })
  })
}
