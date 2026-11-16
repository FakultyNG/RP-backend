import { Router } from 'express'
import { AdsController } from '../../controllers/common/ad.controller'
import { Multer } from '../../utils/Multer'

export const superAdminAdsRouter = Router()

superAdminAdsRouter.post('/create', Multer.createAdConfig, AdsController.create)
superAdminAdsRouter.post('/home', Multer.uploadSingleImage, AdsController.createHomeAd)
superAdminAdsRouter.get('/home', AdsController.fetchHomeAds)
superAdminAdsRouter.get('/fetchall', AdsController.fetchMany)
superAdminAdsRouter.delete('/remove/:id', AdsController.removeById)
