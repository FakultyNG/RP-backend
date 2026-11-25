import { Router } from 'express'
import { AdminUploadController } from '../../controllers/admins/uploads.admin'
import { Multer } from '../../utils/Multer'

export const superAdminUploadsRouter = Router()

superAdminUploadsRouter.post('/multipart/initiate', AdminUploadController.initiateMultipartUpload)
superAdminUploadsRouter.post('/multipart/:sessionId/parts', AdminUploadController.signMultipartParts)
superAdminUploadsRouter.get('/multipart/:sessionId', AdminUploadController.multipartUploadStatus)
superAdminUploadsRouter.post('/multipart/:sessionId/complete', AdminUploadController.completeMultipartUpload)
superAdminUploadsRouter.delete('/multipart/:sessionId', AdminUploadController.abortMultipartUpload)

superAdminUploadsRouter.get('/fetch/:type', AdminUploadController.fetchVideos)
superAdminUploadsRouter.get('/status/:id', AdminUploadController.fetchProcessingStatus)
superAdminUploadsRouter.get('/seasons/fetch/:vidId', AdminUploadController.fetchSeasonsAndEpisodes)

superAdminUploadsRouter.post(
  '/video/add/:type',
  Multer.adminUploadVideoConfig,
  AdminUploadController.addVideo,
)

superAdminUploadsRouter.get('/episodes/can-add/:seasonId', AdminUploadController.canAddEpisode)
superAdminUploadsRouter.get('/seasons/can-add/:videoId', AdminUploadController.canAddSeason)

superAdminUploadsRouter.post(
  '/episodes/add/:seasonId',
  Multer.adminUploadVideoConfig,
  AdminUploadController.addEpisode,
)

superAdminUploadsRouter.put(
  '/episodes/edit/:episodeId',
  Multer.adminUploadVideoConfig,
  AdminUploadController.editEpisode,
)
superAdminUploadsRouter.delete('/episodes/remove/:episodeId', AdminUploadController.deleteEpisode)

superAdminUploadsRouter.post('/seasons/add/:videoId', AdminUploadController.addSeason)
superAdminUploadsRouter.delete('/seasons/remove/:seasonId', AdminUploadController.deleteSeason)

superAdminUploadsRouter.put(
  '/edit/:id',
  Multer.adminUploadVideoConfig,
  AdminUploadController.editVideo,
)

superAdminUploadsRouter.delete('/remove/:id/:type', AdminUploadController.deleteVideo)
