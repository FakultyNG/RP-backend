import { AnalyticsEventInput, AnalyticsService } from '../../services/core/AnalyticsService'
import { Catch } from '../../utils/Catch'
import { GetDefined } from '../../utils/GetDefined'
import { sendResponse } from '../../utils/responder'

export class CustomerAnalyticsController {
  static ingest = Catch.async(async ({ body, user }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const result = await AnalyticsService.ingest(
      currentUser._id.toString(),
      body.events as AnalyticsEventInput[],
    )
    sendResponse({ res, statusCode: 202, data: result, message: 'Analytics accepted' })
  })
}
