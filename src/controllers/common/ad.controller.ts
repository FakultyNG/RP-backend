import { Catch } from '../../utils/Catch'
import { sendResponse } from '../../utils/responder'
import {
  AdManagerService,
  CreateAdData,
  CreateHomeAdData,
} from '../../services/core/AdmanagerService'
import { OperationalError } from '../../utils/OperationalError'
import { UploadMediaUtils } from '../../utils/UploadMediaUtils'
import { validate } from '../../middlewares/requestValidator'
import { createAdSchema, createHomeAdSchema, updateAdSchema } from '../../validations/admin'
import { GetDefined } from '../../utils/GetDefined'
import { UserSchema } from '../../models/users.model'
import { CampaignReportService } from '../../services/core/CampaignReportService'

export class AdsController {
  static publicReport = Catch.async(async (req, res) => {
    const html = await CampaignReportService.publicHtml(req.params.token)
    res.setHeader('Cache-Control', 'private, no-store')
    res.type('html').send(html)
  })

  static createHomeAd = Catch.async(async (req, res) => {
    if (!req.file) {
      throw new OperationalError('One horizontal poster is required', 400)
    }

    const data: CreateHomeAdData = {
      title: req.body.title,
      link: req.body.link,
      start: req.body.start,
      expiry: req.body.expiry,
      active: req.body.active === 'true' || req.body.active === true,
      imageFile: req.file,
    }
    validate(createHomeAdSchema, data)
    const ad = await AdManagerService.createHomeAd(data)

    sendResponse({
      res,
      statusCode: 201,
      message: `${ad.title} added to Home-Ads`,
      data: ad,
    })
  })

  static fetchHomeAds = Catch.async(async (_req, res) => {
    const ads = await AdManagerService.getHomeAds()
    sendResponse({ res, data: ads, message: 'Home-Ads fetched' })
  })

  static create = Catch.async(async (req, res) => {
    if (req.body.data == null || typeof req.body.data !== 'string') {
      throw new OperationalError(
        'formData.data is required and must be a JSON serialized string',
        400,
      )
    }

    const files = UploadMediaUtils.checkFiles(req.files)

    if (Object.keys(files).length === 0) {
      throw new OperationalError('Expected at least one file', 400)
    }

    const data: CreateAdData = {
      ...JSON.parse(req.body.data),
      videoFile: files.video?.[0],
      imageFile: files.image?.[0],
    }

    validate(createAdSchema, data)

    const ad = await AdManagerService.create(data)

    sendResponse({
      res,
      statusCode: 201,
      message: `${ad.title} added`,
      data: ad,
    })
  })

  static update = Catch.async(async (req, res) => {
    if (req.body.data == null || typeof req.body.data !== 'string') {
      throw new OperationalError(
        'formData.data is required and must be a JSON serialized string',
        400,
      )
    }

    const files = UploadMediaUtils.checkFiles(req.files)
    const data = {
      ...JSON.parse(req.body.data),
      videoFile: files.video?.[0],
      imageFile: files.image?.[0],
    }
    validate(updateAdSchema, data)
    const ad = await AdManagerService.update(req.params.id, data)

    sendResponse({ res, data: ad, message: `${ad.title} updated` })
  })

  static fetchMany = Catch.async(async ({ query, user }, res) => {
    const ads = await AdManagerService.getMany(GetDefined.loggedInUser(user).videoQuality, query)

    sendResponse({
      res,
      data: ads,
      message: 'ads fetched',
    })
  })

  static fetchRandom = Catch.async(async ({ query, user }, res) => {


    let vidQuality: UserSchema['videoQuality']


    try {
      vidQuality = GetDefined.loggedInUser(user).videoQuality
    } catch (e) {
      vidQuality = '720p'
    }

    const ads = await AdManagerService.getRandom(
      vidQuality,
      query.type,
    )

    sendResponse({
      res,
      data: ads,
      message: 'ad fetched',
    })
  })

  static removeById = Catch.async(async (req, res) => {
    await AdManagerService.deleteAd(req.params.id)

    sendResponse({
      res,
      message: 'ad deleted',
    })
  })

  static analytics = Catch.async(async (req, res) => {
    const data = await CampaignReportService.analytics(req.params.id, {
      days: Number(req.query.days) || 30,
    })
    sendResponse({ res, data, message: 'Campaign analytics fetched' })
  })

  static exportCsv = Catch.async(async (req, res) => {
    const { report, csv } = await CampaignReportService.csv(req.params.id, {
      days: Number(req.query.days) || 30,
    })
    const filename = `${report.campaign.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-analytics.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csv)
  })

  static sendReport = Catch.async(async (req, res) => {
    const data = await CampaignReportService.sendReport(req.params.id)
    sendResponse({ res, data, message: 'Campaign report delivery completed' })
  })

  static regenerateReportLink = Catch.async(async (req, res) => {
    const reportLink = await CampaignReportService.regenerateLink(req.params.id)
    sendResponse({ res, data: { reportLink }, message: 'Campaign report link regenerated' })
  })

  static reportDeliveries = Catch.async(async (req, res) => {
    const data = await CampaignReportService.deliveries(req.params.id)
    sendResponse({ res, data, message: 'Campaign report delivery history fetched' })
  })
}
