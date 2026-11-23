import { Router } from 'express'
import { AdsController } from '../../controllers/common/ad.controller'
import { Multer } from '../../utils/Multer'

export const superAdminAdsRouter = Router()

superAdminAdsRouter.post('/create', Multer.createAdConfig, AdsController.create)
superAdminAdsRouter.post('/home', Multer.uploadSingleImage, AdsController.createHomeAd)
superAdminAdsRouter.get('/home', AdsController.fetchHomeAds)
superAdminAdsRouter.put('/update/:id', Multer.createAdConfig, AdsController.update)
superAdminAdsRouter.get('/fetchall', AdsController.fetchMany)
superAdminAdsRouter.get('/:id/analytics', AdsController.analytics)
superAdminAdsRouter.get('/:id/analytics.csv', AdsController.exportCsv)
superAdminAdsRouter.get('/:id/report-deliveries', AdsController.reportDeliveries)
superAdminAdsRouter.post('/:id/send-report', AdsController.sendReport)
superAdminAdsRouter.post('/:id/regenerate-report-link', AdsController.regenerateReportLink)
superAdminAdsRouter.delete('/remove/:id', AdsController.removeById)
