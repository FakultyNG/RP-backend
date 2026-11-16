import express from 'express'
import { adminRouter } from './admin.route'
import { clientsRouter } from './clientRoutes'
import { customerRouter } from './customerRoutes'
import { superAdminRouter } from './superAdminRoutes'
import { webhooksRouter } from './webhooksRoutes'
import { merchantRouter } from './merchantRoutes'
import { LivestreamCntroller } from '../controllers/livestream/live.controller'
import fs from 'node:fs'
import path from 'node:path'

export const v1Router = express.Router()

const backendVersion = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
).version as string

v1Router.get('/version', (_, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    status: 200,
    message: 'Backend version fetched',
    data: { version: backendVersion },
  })
})

v1Router.post('/on_publish', LivestreamCntroller.handleRTMPLivestreamOnPublish)
v1Router.post('/on_publish_done', LivestreamCntroller.handleRTMPLivestreamOnPublishDone)

v1Router.use('/webhooks', webhooksRouter)
v1Router.use('/customers', customerRouter)
v1Router.use('/clients', clientsRouter)
v1Router.use('/admin', adminRouter)
v1Router.use('/superadmin', superAdminRouter)
v1Router.use('/merchants', merchantRouter)

export default v1Router
