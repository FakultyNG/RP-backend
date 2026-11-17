import { NotificationAudience } from '../../notifications/notification'
import { AdminNotificationCategory, AdminNotificationCenterService } from './AdminNotificationCenterService'
import { NotificationService } from './NotificationService'

type ContentLifecycleNotification = {
  eventKey: string
  title: string
  description: string
  category: Exclude<AdminNotificationCategory, 'suggestions' | 'system'>
  route: string
  type: string
  audience: NotificationAudience
  metadata?: Record<string, unknown>
  photo?: { Bucket: string; Key: string }
}

export class ContentLifecycleNotificationService {
  static publish = async (event: ContentLifecycleNotification) => {
    await Promise.all([
      AdminNotificationCenterService.publish({
        eventKey: event.eventKey,
        title: event.title,
        description: event.description,
        category: event.category,
        route: event.route,
        metadata: event.metadata,
      }),
      NotificationService.createAutomatedNotification({
        eventKey: event.eventKey,
        title: event.title,
        description: event.description,
        type: event.type,
        audience: event.audience,
        metadata: event.metadata,
        photo: event.photo,
      }),
    ])
  }
}
