import { Router } from 'express'
import Joi from 'joi'
import { PlatformSettingsController } from '../../controllers/common/platformSettings.controller'
import { requestValidator } from '../../middlewares/requestValidator'

export const superAdminPlatformSettingsRouter = Router()

superAdminPlatformSettingsRouter
  .route('/guest-access')
  .get(PlatformSettingsController.getGuestAccess)
  .put(
    requestValidator({ body: Joi.object({ enabled: Joi.boolean().required() }) }),
    PlatformSettingsController.setGuestAccess,
  )
