import { Router } from 'express'
import { AdminGiftCardController } from '../../controllers/admins/giftcard.admin'
import { requestValidator } from '../../middlewares/requestValidator'
import { createGiftCardSchema } from '../../validations/admin'
import Joi from 'joi'

export const superAdminGiftCardRouter = Router()

superAdminGiftCardRouter.post(
  '/generate/new',
  requestValidator(createGiftCardSchema),
  AdminGiftCardController.create,
)

superAdminGiftCardRouter.put('/activate/:code/:token', AdminGiftCardController.activate)
superAdminGiftCardRouter.put(
  '/activate/:code',
  requestValidator({
    params: Joi.object({ code: Joi.string().trim().required() }),
    body: Joi.object({ authorizationCode: Joi.string().min(4).max(128).required() }),
  }),
  AdminGiftCardController.activateSecurely,
)
superAdminGiftCardRouter
  .route('/authorization-code')
  .get(AdminGiftCardController.getAuthorizationCodeStatus)
  .put(
    requestValidator({
      body: Joi.object({ newCode: Joi.string().trim().min(4).max(128).required() }),
    }),
    AdminGiftCardController.changeAuthorizationCode,
  )
superAdminGiftCardRouter.get('/generated/fetch', AdminGiftCardController.fetch)
superAdminGiftCardRouter.delete('/:id', AdminGiftCardController.deleteById)
