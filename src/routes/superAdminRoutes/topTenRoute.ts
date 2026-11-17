import {Router} from 'express'
import {AdminTopTenController} from '../../controllers/admins/topTen.admin'
import {requestValidator} from '../../middlewares/requestValidator'
import {replaceTopTenSchema} from '../../validations/admin'

export const superAdminTopTenRouter = Router()

superAdminTopTenRouter.get('/', AdminTopTenController.fetch)
superAdminTopTenRouter.post('/auto-rank', AdminTopTenController.autoRank)
superAdminTopTenRouter.put(
  '/',
  requestValidator(replaceTopTenSchema),
  AdminTopTenController.replace,
)
