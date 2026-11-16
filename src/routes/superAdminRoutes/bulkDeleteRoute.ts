import { Router } from 'express'
import { AdminBulkDeleteController } from '../../controllers/admins/bulk-delete.admin'

export const superAdminBulkDeleteRouter = Router()

superAdminBulkDeleteRouter.delete('/', AdminBulkDeleteController.deleteMany)
