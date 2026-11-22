import { S3 } from '../aws/s3'
import { UserModel } from '../../models/users.model'
import { UserRepo } from '../../repositories/UserRepo'
import { OperationalError } from '../../utils/OperationalError'
import { ExpressRequestQuery, QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import {
  Notification,
  NotificationAudience,
  NotificationPayload,
} from '../../notifications/notification'
import { LoggedInUser, MulterFile } from '../../types'
import { MediaManagement } from '../media-management'
import env from '../../env'
import { NotificationService } from './NotificationService'
import { AdminNotificationCenterService } from './AdminNotificationCenterService'

export class AdminUsersService {
  static sendAdminMainTopicPushNotification = async (
    currentUser: LoggedInUser,
    payload: Omit<NotificationPayload, 'image'> & { audience?: NotificationAudience },
    imageFile?: MulterFile,
  ) => {
    let image: string | undefined = undefined
    let photo: { Bucket: string; Key: string } | undefined
    const type = payload.type || 'MAIN_ADMIN_TOPIC_NOTIFICATION'
    const metadata = payload.metadata || { destination: 'notifications' }
    const audience = payload.audience || 'all'

    if (imageFile) {
      const upload = await MediaManagement.storeImageAndSubtitle(
        imageFile,
        undefined,
        'landscape-poster',
      )
      image = env.CDN_IMAGES_BASE_URL + '/' + upload.Key
      photo = { Bucket: upload.Bucket, Key: upload.Key }
    }

    const [storedNotification, delivery] = await Promise.all([
      NotificationService.createStoredAdminNotification({
        currentUser,
        title: payload.title,
        description: payload.body,
        type,
        metadata,
        photo,
      }),
      Notification.sendPreferencePushNotification(
        audience,
        {
          ...payload,
          type,
          metadata,
          image,
        },
      ),
    ])

    await AdminNotificationCenterService.publish({
      eventKey: `broadcast:${storedNotification._id}`,
      title: payload.title,
      description: payload.body,
      category: audience === 'all' ? 'new_services' : audience,
      route: '',
      metadata: { ...metadata, audience },
    })

    return delivery
  }

  static fetchAll = async (query: ExpressRequestQuery) => {
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)
    const users = await UserRepo.adminFetchAllCustomersAggr(page, limit)
    return users
  }

  static fetchOne = async (userId: string) => {
    const [user] = await UserRepo.adminFetchSingleCustomerAggr(userId)

    if (!user) {
      throw new OperationalError('User not found', 404)
    }

    return user
  }

  static deleteOne = async (userId: string) => {
    const deletedUser = await UserModel.findByIdAndDelete(userId)

    if (!deletedUser) {
      throw new OperationalError('user can not be deleted or not found', 400)
    }

    if (deletedUser.photo) {
      const {
        photo: { Key, Bucket },
      } = deletedUser

      S3.deleteObject(Key, Bucket).catch(e => {
        console.error(`Error deleted user photo with key: ${Key} and bucket: ${Bucket}`)
        console.error('Reason', e)
      })
    }
  }
}
