import express from 'express'
import { adminRouter } from './admin.route'
import { clientsRouter } from './clientRoutes'
import { customerRouter } from './customerRoutes'
import { superAdminRouter } from './superAdminRoutes'
import { webhooksRouter } from './webhooksRoutes'
import { merchantRouter } from './merchantRoutes'
import { LivestreamCntroller } from '../controllers/livestream/live.controller'
import { getBuildInfo } from '../utils/buildInfo'
import { AdsController } from '../controllers/common/ad.controller'

export const v1Router = express.Router()

v1Router.get('/version', (_, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    status: 200,
    message: 'Backend version fetched',
    data: getBuildInfo(),
  })
})

v1Router.post('/on_publish', LivestreamCntroller.handleRTMPLivestreamOnPublish)
v1Router.post('/on_publish_done', LivestreamCntroller.handleRTMPLivestreamOnPublishDone)
v1Router.get('/ads/report/:token', AdsController.publicReport)

v1Router.use('/webhooks', webhooksRouter)
v1Router.use('/customers', customerRouter)
v1Router.use('/clients', clientsRouter)
v1Router.use('/admin', adminRouter)
v1Router.use('/superadmin', superAdminRouter)
v1Router.use('/merchants', merchantRouter)

export default v1Router
