import { AdModel, AdSchema } from '../../models/admanager.model'
import { AdManagerRepo, FetchAdResult } from '../../repositories/AddManagerRepo'
import { ExpressRequestQuery, QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import { OperationalError } from '../../utils/OperationalError'
import { MulterFile } from '../../types'
import { MediaManagement } from '../media-management'
import { MaybeSession, withMongoDBSession } from '../../utils/mongoDbSessionRunner'
import { Purge } from '../../utils/Purge'
import { VideoQuality, VidUploadUtils } from '../../utils/VideoUploadUtils'
import { MediaAccess } from '../media-access'
import { UploadMediaUtils } from '../../utils/UploadMediaUtils'
import { CategoryEnumService } from './CategoryEnumsService'

export interface CreateAdData
  extends Omit<AdSchema, 'createdAt' | 'updatedAt' | 'video' | 'photo'> {
  videoFile: MulterFile
  imageFile: MulterFile
}

export interface CreateHomeAdData {
  title: string
  link: string
  start: string
  expiry: string
  active: boolean
  imageFile: MulterFile
}

export interface UpdateAdData {
  title: string
  type: 'general' | 'web' | 'mobile' | 'home_ad'
  brand: string
  link: string
  cta: string
  duration?: number
  start: string
  expiry: string
  active: boolean
  videoFile?: MulterFile
  imageFile?: MulterFile
}

interface UploadMediaInput {
  videoFile: MulterFile
  imageFile: MulterFile
  expire: Date
}

export class AdManagerService {
  protected static _resolveMediaSources = (ads: FetchAdResult[], quality?: VideoQuality) => {
    return ads.map(ad => {
      const photoUrl = MediaAccess.getImageAndSubtitleURL(ad.photo.Key)
      const videoUrl = ad.videoUpload
        ? VidUploadUtils.getResSourceUrl(ad.videoUpload, quality ?? '720p')
        : undefined

      return Object.assign(ad, {
        photoUrl,
        videoUrl,
        videoUpload: undefined,
        photo: undefined,
        __v: undefined,
        isVideoReady: undefined,
      })
    })
  }

  protected static _uploadMedia = async ({ videoFile, imageFile, expire }: UploadMediaInput) => {
    const [imageUploadResult, videoUploadResult] = await Promise.allSettled([
      MediaManagement.storeImageAndSubtitle(imageFile, expire, 'landscape-poster'),
      MediaManagement.uploadAndInitiateMediaConvert(videoFile, expire),
    ])

    if (imageUploadResult.status === 'rejected') {
      throw imageUploadResult.reason
    }

    if (videoUploadResult.status === 'rejected') {
      throw videoUploadResult.reason
    }

    return {
      imageUpload: imageUploadResult.value,
      videoUpload: videoUploadResult.value,
    }
  }

  static create = async (data: CreateAdData) =>
    await withMongoDBSession(this._createTransaction, data)

  static createHomeAd = async ({
    title,
    link,
    start,
    expiry,
    active,
    imageFile,
  }: CreateHomeAdData) => {
    await CategoryEnumService.ensurePremiumAdsCategory()

    const { startAt, expireAt } = this._schedule(start, expiry)

    const imageUpload = await MediaManagement.storeImageAndSubtitle(
      imageFile,
      expireAt,
      'landscape-poster',
    )

    return await AdModel.create({
      title,
      type: 'home_ad',
      brand: 'Home-Ads',
      link,
      cta: 'Learn More',
      duration: 0,
      start: startAt,
      expiry: expireAt,
      active,
      photo: {
        Bucket: imageUpload.Bucket,
        Key: imageUpload.Key,
      },
    })
  }

  protected static _schedule = (start: string | Date, expiry: string | Date) => {
    const startAt = new Date(start)
    const expireAt = new Date(expiry)
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(expireAt.getTime()) ||
      expireAt <= startAt ||
      expireAt <= new Date()
    ) {
      throw new OperationalError('Expiry must be later than the start time and in the future', 400)
    }
    return { startAt, expireAt }
  }

  static getHomeAds = async () => {
    await this.deleteExpiredAds()
    const ads = await AdManagerRepo.fetchHomeAds()
    return ads.map(ad => ({
      _id: ad._id,
      title: ad.title,
      type: ad.type,
      link: ad.link,
      active: ad.active,
      photoUrl: MediaAccess.getImageAndSubtitleURL(ad.photo.Key),
      createdAt: ad.createdAt,
      updatedAt: ad.updatedAt,
    }))
  }

  static _createTransaction = async (
    {
      active,
      expiry,
      start,
      duration,
      link,
      videoFile,
      imageFile,
      brand,
      type,
      title,
      cta,
    }: CreateAdData,
    session: MaybeSession,
  ) => {
    const { startAt, expireAt } = this._schedule(start, expiry)

    const { imageUpload, videoUpload } = await this._uploadMedia({
      videoFile,
      imageFile,
      expire: expireAt,
    })

    const adDocument = new AdModel({
      title,
      type,
      brand,
      link,
      duration,
      cta,
      active,
      expiry: expireAt,
      start: startAt,
      photo: {
        Bucket: imageUpload.Bucket,
        Key: imageUpload.Key,
      },
    })

    const videoUploadDocument = UploadMediaUtils.getVideoUploadDocument(videoUpload)
    videoUploadDocument.parentId = adDocument._id
    videoUploadDocument.parentType = 'ad'
    adDocument.videoUpload = videoUploadDocument._id
    await adDocument.save({ session })
    await videoUploadDocument.save({ session })
    return adDocument
  }

  static update = async (adId: string, data: UpdateAdData) => {
    const ad = await AdModel.findById(adId)
    if (ad === null) {
      throw new OperationalError('Ad not found', 404)
    }

    const { startAt, expireAt } = this._schedule(data.start, data.expiry)
    const previousPhoto = ad.photo
    const previousVideoUpload = ad.videoUpload
    let replacementPhoto = ad.photo
    let replacementVideoUpload = ad.videoUpload

    if (data.type !== 'home_ad' && !data.videoFile && !replacementVideoUpload) {
      throw new OperationalError('A video file is required for this ad placement', 400)
    }

    if (data.imageFile) {
      const uploadedPhoto = await MediaManagement.storeImageAndSubtitle(
        data.imageFile,
        expireAt,
        'landscape-poster',
      )
      replacementPhoto = { Bucket: uploadedPhoto.Bucket, Key: uploadedPhoto.Key }
    }

    if (data.type === 'home_ad') {
      replacementVideoUpload = undefined
      await CategoryEnumService.ensurePremiumAdsCategory()
    } else if (data.videoFile) {
      const uploadedVideo = await MediaManagement.uploadAndInitiateMediaConvert(
        data.videoFile,
        expireAt,
      )
      const videoUploadDocument = UploadMediaUtils.getVideoUploadDocument(uploadedVideo)
      videoUploadDocument.parentId = ad._id
      videoUploadDocument.parentType = 'ad'
      await videoUploadDocument.save()
      replacementVideoUpload = videoUploadDocument._id
    }

    ad.set({
      title: data.title.trim(),
      type: data.type,
      brand: data.type === 'home_ad' ? 'Home-Ads' : data.brand.trim(),
      link: data.link.trim(),
      cta: data.type === 'home_ad' ? 'Learn More' : data.cta.trim(),
      duration: data.duration ?? 0,
      start: startAt,
      expiry: expireAt,
      active: data.active,
      photo: replacementPhoto,
      videoUpload: replacementVideoUpload,
      isVideoReady:
        data.type === 'home_ad' ? false : data.videoFile ? false : ad.isVideoReady,
    })
    await ad.save()

    const cleanup: Promise<unknown>[] = []
    if (data.imageFile) {
      cleanup.push(MediaManagement.deleteObject(previousPhoto.Key, previousPhoto.Bucket))
    }
    if (previousVideoUpload && previousVideoUpload.toString() !== replacementVideoUpload?.toString()) {
      cleanup.push(Purge.videoUploadById(previousVideoUpload))
    }
    await Promise.allSettled(cleanup)
    return ad
  }

  static getMany = async (videoQuality: VideoQuality, query: ExpressRequestQuery) => {
    await this.deleteExpiredAds()
    const { skip, limit } = QueryParamsFeatures.paginagteParams(query)

    const ads = await AdManagerRepo.fetchMany({
      skip,
      limit,
      type: query.type,
    })

    return this._resolveMediaSources(ads, videoQuality)
  }

  static getRandom = async (videoQuality: VideoQuality, type: unknown) => {
    const ads = await AdManagerRepo.fetcRandom(type)
    return this._resolveMediaSources(ads, videoQuality)
  }

  protected static _deleteMedia = async (ad: AdSchema) => {
    const cleanup: Promise<unknown>[] = [
      MediaManagement.deleteObject(ad.photo.Key, ad.photo.Bucket),
    ]
    if (ad.videoUpload) cleanup.push(Purge.videoUploadById(ad.videoUpload))
    await Promise.allSettled(cleanup)
  }

  static deleteExpiredAds = async () => {
    const expiredAds = await AdModel.find({ expiry: { $lte: new Date() } })
    await Promise.allSettled(
      expiredAds.map(async ad => {
        const deleted = await AdModel.findOneAndDelete({ _id: ad._id, expiry: { $lte: new Date() } })
        if (deleted) await this._deleteMedia(deleted)
      }),
    )
    return expiredAds.length
  }

  static deleteAd = async (addId: string) => {
    const deletedAdDocument = await AdModel.findByIdAndDelete(addId)

    if (deletedAdDocument == null) {
      throw new OperationalError('Ad not found', 404)
    }

    await this._deleteMedia(deletedAdDocument)
  }
}
