import { Router } from 'express'
import { CustomerSettingsController } from '../../controllers/customers/settings.customer'
import { requestValidator } from '../../middlewares/requestValidator'
import {
  interestPreferencesSchema,
  notificationPreferencesSchema,
  videoQualitySchema,
} from '../../validations/customers'

export const router = Router()

router.put('/notification-vidquality', CustomerSettingsController.notificationSettings)
router.patch(
  '/notifications',
  requestValidator(notificationPreferencesSchema),
  CustomerSettingsController.notificationPreferences,
)
router.patch(
  '/video-quality',
  requestValidator(videoQualitySchema),
  CustomerSettingsController.videoQuality,
)
router.post('/watchlist/add', CustomerSettingsController.addToWatchList)
router.post('/watchlist/rem', CustomerSettingsController.remFromWatchList)
router.put(
  '/interests',
  requestValidator(interestPreferencesSchema),
  CustomerSettingsController.replaceInterests,
)
router.post('/interest/add', CustomerSettingsController.addToInterest)
