import { AdminBulkDeleteService } from '../../services/core/AdminBulkDeleteService'
import { Catch } from '../../utils/Catch'
import { GetDefined } from '../../utils/GetDefined'
import { sendResponse } from '../../utils/responder'

export class AdminBulkDeleteController {
  static deleteMany = Catch.async(async (req, res) => {
    const result = await AdminBulkDeleteService.deleteMany({
      resource: req.body?.resource,
      ids: req.body?.ids,
      currentUser: GetDefined.loggedInUser(req.user),
    })

    sendResponse({
      res,
      data: result,
      message:
        result.failed.length === 0
          ? `${result.deleted} records deleted`
          : `${result.deleted} records deleted; ${result.failed.length} failed`,
    })
  })
}
