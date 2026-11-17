import { AdminUsersService } from '../../services/core/AdminUsersService'
import { Catch } from '../../utils/Catch'
import { GetDefined } from '../../utils/GetDefined'
import { sendResponse } from '../../utils/responder'

export class AdminUsersController {
  static sendMainPushNotification = Catch.async(async ({ body, file, user }, res) => {
    const delivery = await AdminUsersService.sendAdminMainTopicPushNotification(
      GetDefined.loggedInUser(user),
      {
        ...body,
        metadata: typeof body.metadata === 'string' ? JSON.parse(body.metadata) : {},
        type: body.type || 'MAIN_ADMIN_TOPIC_NOTIFICATION',
        audience: body.audience || 'all',
      },
      file,
    )

    sendResponse({
      res,
      data: delivery,
      message:
        delivery.targetedDevices === 0
          ? 'Notification saved, but no enabled devices were registered'
          : `Notification broadcast delivered to ${delivery.sent} device${delivery.sent === 1 ? '' : 's'}`,
    })
  })

  static adminFetchUsers = Catch.async(async ({ query }, res) => {
    sendResponse({
      res,
      data: await AdminUsersService.fetchAll(query),
      message: 'Users detials fetched',
    })
  })

  static adminFetchSingleUser = Catch.async(async (req, res) => {
    sendResponse({
      res,
      data: await AdminUsersService.fetchOne(req.params.userId),
      message: 'user fetched successfully',
    })
  })

  static adminDeleteUser = Catch.async(async (req, res) => {
    await AdminUsersService.deleteOne(req.params.userId)

    sendResponse({
      res,
      message: 'user deleted successfully',
    })
  })
}
