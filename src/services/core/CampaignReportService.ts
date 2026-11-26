import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Types } from 'mongoose'
import env from '../../env'
import { AdModel } from '../../models/admanager.model'
import { AdReportDeliveryModel } from '../../models/adReportDelivery.model'
import { ContentAnalyticsEventModel } from '../../models/contentAnalytics.model'
import { OperationalError } from '../../utils/OperationalError'
import { sendTransactionalEmail } from '../../utils/emailer'

type ReportFrequency = 'daily' | 'weekly' | 'monthly'
type ReportDelivery = 'live_link' | 'csv'

const reportEvents = [
  'house_ad_impression',
  'house_ad_click',
  'house_ad_video_start',
  'house_ad_video_25',
  'house_ad_video_50',
  'house_ad_video_75',
  'house_ad_video_complete',
] as const

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`

const addFrequency = (from: Date, frequency: ReportFrequency) => {
  const next = new Date(from)
  if (frequency === 'daily') next.setUTCDate(next.getUTCDate() + 1)
  if (frequency === 'weekly') next.setUTCDate(next.getUTCDate() + 7)
  if (frequency === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

const reportPeriodStart = (end: Date, frequency: ReportFrequency) => {
  const start = new Date(end)
  if (frequency === 'daily') start.setUTCDate(start.getUTCDate() - 1)
  if (frequency === 'weekly') start.setUTCDate(start.getUTCDate() - 7)
  if (frequency === 'monthly') start.setUTCMonth(start.getUTCMonth() - 1)
  return start
}

export class CampaignReportService {
  static nextReportAt(start: Date, enabled: boolean) {
    if (!enabled) return undefined
    const now = new Date()
    return start > now ? start : now
  }

  static reportLink(adId: string, version: number) {
    const payload = `${adId}:${version}`
    const signature = createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url')
    return `${env.PUBLIC_SHARE_ORIGIN}/reports/${adId}.${signature}`
  }

  static verifyReportToken(token: string) {
    const separator = token.indexOf('.')
    if (separator < 1) throw new OperationalError('Invalid campaign report link', 404)
    const adId = token.slice(0, separator)
    const signature = token.slice(separator + 1)
    if (!Types.ObjectId.isValid(adId)) throw new OperationalError('Invalid campaign report link', 404)
    return { adId, signature }
  }

  static getAdFromToken = async (token: string) => {
    const { adId, signature } = this.verifyReportToken(token)
    const ad = await AdModel.findById(adId)
    if (!ad) throw new OperationalError('Campaign report was not found', 404)
    if (Date.now() > ad.expiry.getTime() + 30 * 86_400_000) {
      throw new OperationalError('This campaign report link has expired', 410)
    }
    const expected = this.reportLink(adId, ad.reportTokenVersion).split('.').pop() ?? ''
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new OperationalError('This campaign report link has been revoked', 403)
    }
    return ad
  }

  static analytics = async (adId: string, options: { days?: number; from?: Date; to?: Date } = {}) => {
    if (!Types.ObjectId.isValid(adId)) throw new OperationalError('Invalid ad id', 400)
    const ad = await AdModel.findById(adId).lean()
    if (!ad) throw new OperationalError('Ad not found', 404)
    const to = options.to ?? new Date()
    const days = Math.min(Math.max(Number(options.days) || 30, 1), 400)
    const from = options.from ?? new Date(to.getTime() - days * 86_400_000)
    const match = {
      adId: new Types.ObjectId(adId),
      eventType: { $in: reportEvents },
      occurredAt: { $gte: from, $lte: to },
    }

    const [eventRows, placementRows, platformRows, trendRows] = await Promise.all([
      ContentAnalyticsEventModel.aggregate([
        { $match: match },
        { $group: { _id: '$eventType', count: { $sum: 1 }, viewers: { $addToSet: '$viewerKey' } } },
        { $project: { eventType: '$_id', count: 1, uniqueViewers: { $size: '$viewers' }, _id: 0 } },
      ]),
      ContentAnalyticsEventModel.aggregate([
        { $match: match },
        { $group: { _id: { $ifNull: ['$sourceScreen', 'Unknown'] }, impressions: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_impression'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_click'] }, 1, 0] } }, starts: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_video_start'] }, 1, 0] } }, completions: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_video_complete'] }, 1, 0] } } } },
        { $project: { placement: '$_id', impressions: 1, clicks: 1, starts: 1, completions: 1, _id: 0 } },
        { $sort: { impressions: -1 } },
      ]),
      ContentAnalyticsEventModel.aggregate([
        { $match: match },
        { $group: { _id: { $ifNull: ['$platform', 'unknown'] }, impressions: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_impression'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_click'] }, 1, 0] } } } },
        { $project: { platform: '$_id', impressions: 1, clicks: 1, _id: 0 } },
      ]),
      ContentAnalyticsEventModel.aggregate([
        { $match: match },
        { $group: { _id: '$day', impressions: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_impression'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_click'] }, 1, 0] } }, completions: { $sum: { $cond: [{ $eq: ['$eventType', 'house_ad_video_complete'] }, 1, 0] } } } },
        { $sort: { _id: 1 } },
        { $project: { day: '$_id', impressions: 1, clicks: 1, completions: 1, _id: 0 } },
      ]),
    ])

    const events = new Map(eventRows.map(row => [row.eventType, row]))
    const impressions = events.get('house_ad_impression')?.count ?? 0
    const clicks = events.get('house_ad_click')?.count ?? 0
    const videoStarts = events.get('house_ad_video_start')?.count ?? 0
    const completions = events.get('house_ad_video_complete')?.count ?? 0

    return {
      campaign: {
        id: ad._id,
        title: ad.title,
        brand: ad.brand,
        start: ad.start,
        expiry: ad.expiry,
        active: ad.active,
        archivedAt: ad.archivedAt,
      },
      period: { from, to },
      summary: {
        impressions,
        uniqueViewers: events.get('house_ad_impression')?.uniqueViewers ?? 0,
        clicks,
        ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        videoStarts,
        video25: events.get('house_ad_video_25')?.count ?? 0,
        video50: events.get('house_ad_video_50')?.count ?? 0,
        video75: events.get('house_ad_video_75')?.count ?? 0,
        videoCompletions: completions,
        completionRate: videoStarts
          ? Number(((completions / videoStarts) * 100).toFixed(2))
          : 0,
      },
      placements: placementRows.map(row => ({
        ...row,
        ctr: row.impressions ? Number(((row.clicks / row.impressions) * 100).toFixed(2)) : 0,
      })),
      platforms: platformRows,
      trend: trendRows,
    }
  }

  static csv = async (adId: string, options: { days?: number; from?: Date; to?: Date } = {}) => {
    const report = await this.analytics(adId, options)
    const rows: unknown[][] = [
      ['Campaign', report.campaign.title],
      ['Advertiser', report.campaign.brand],
      ['Period start', report.period.from.toISOString()],
      ['Period end', report.period.to.toISOString()],
      [],
      ['Metric', 'Value'],
      ...Object.entries(report.summary),
      [],
      ['Placement', 'Impressions', 'Clicks', 'CTR', 'Video starts', 'Video completions'],
      ...report.placements.map(row => [row.placement, row.impressions, row.clicks, row.ctr, row.starts, row.completions]),
      [],
      ['Platform', 'Impressions', 'Clicks'],
      ...report.platforms.map(row => [row.platform, row.impressions, row.clicks]),
    ]
    return { report, csv: rows.map(row => row.map(csvCell).join(',')).join('\r\n') }
  }

  static regenerateLink = async (adId: string) => {
    const ad = await AdModel.findByIdAndUpdate(adId, { $inc: { reportTokenVersion: 1 } }, { new: true })
    if (!ad) throw new OperationalError('Ad not found', 404)
    return this.reportLink(ad.id, ad.reportTokenVersion)
  }

  static deliveries = async (adId: string) =>
    AdReportDeliveryModel.find({ adId }).sort({ createdAt: -1 }).limit(50).lean()

  static sendReport = async (adId: string, frequency: ReportFrequency | 'manual' = 'manual') => {
    const ad = await AdModel.findById(adId)
    if (!ad) throw new OperationalError('Ad not found', 404)
    if (!ad.advertiserEmails.length) throw new OperationalError('Add an advertiser email first', 400)
    if (ad.reportDelivery === 'none') throw new OperationalError('Choose a report delivery mode first', 400)

    const end = new Date()
    const effectiveFrequency = frequency === 'manual' ? ad.reportFrequency : frequency
    const start = frequency === 'manual'
      ? new Date(Math.max(ad.start.getTime(), end.getTime() - 30 * 86_400_000))
      : reportPeriodStart(end, effectiveFrequency)
    const delivery = ad.reportDelivery as ReportDelivery
    const reportLink = this.reportLink(ad.id, ad.reportTokenVersion)
    const { report, csv } = await this.csv(ad.id, { from: start, to: end })
    const results: Array<{ recipient: string; status: string }> = []

    for (const recipient of ad.advertiserEmails) {
      const idempotencyKey = frequency === 'manual'
        ? `${ad.id}:manual:${recipient}:${randomUUID()}`
        : `${ad.id}:${delivery}:${recipient}:${end.toISOString().slice(0, 13)}`
      const log = await AdReportDeliveryModel.findOneAndUpdate(
        { idempotencyKey },
        { $setOnInsert: { adId: ad._id, recipient, delivery, frequency, periodStart: start, periodEnd: end, status: 'pending', idempotencyKey } },
        { upsert: true, new: true },
      )
      if (log.status === 'sent') {
        results.push({ recipient, status: 'already_sent' })
        continue
      }

      try {
        const summary = report.summary
        const body = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#18181b"><h1 style="color:#dc2626">${escapeHtml(ad.title)}</h1><p>Campaign report for <strong>${escapeHtml(ad.brand)}</strong>.</p><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px"><p><strong>${summary.impressions}</strong><br>Impressions</p><p><strong>${summary.clicks}</strong><br>Clicks</p><p><strong>${summary.ctr}%</strong><br>CTR</p><p><strong>${summary.completionRate}%</strong><br>Video completion</p></div>${delivery === 'live_link' ? `<p><a href="${reportLink}" style="display:inline-block;background:#dc2626;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">View live analytics</a></p><p style="font-size:12px;color:#71717a">This private link is read-only. Contact Reeplay if it should be revoked.</p>` : '<p>The detailed CSV report is attached.</p>'}</div>`
        await sendTransactionalEmail({
          to: recipient,
          subject: `${ad.title} campaign analytics`,
          html: body,
          attachments: delivery === 'csv'
            ? [{ filename: `${ad.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-analytics.csv`, content: Buffer.from(csv), contentType: 'text/csv' }]
            : undefined,
        })
        await AdReportDeliveryModel.updateOne({ _id: log._id }, { $set: { status: 'sent', sentAt: new Date() }, $unset: { error: 1 } })
        results.push({ recipient, status: 'sent' })
      } catch (error: any) {
        await AdReportDeliveryModel.updateOne({ _id: log._id }, { $set: { status: 'failed', error: String(error?.message ?? error).slice(0, 500) } })
        results.push({ recipient, status: 'failed' })
      }
    }

    if (results.some(result => result.status === 'sent')) ad.lastReportAt = end
    await ad.save()
    return results
  }

  static processDueReports = async () => {
    const now = new Date()
    const due = await AdModel.find({
      reportDelivery: { $in: ['live_link', 'csv'] },
      advertiserEmails: { $exists: true, $ne: [] },
      nextReportAt: { $lte: now },
      expiry: { $gt: now },
      archivedAt: { $exists: false },
    }).limit(50)

    for (const ad of due) {
      const next = addFrequency(now, ad.reportFrequency)
      const claimed = await AdModel.updateOne(
        { _id: ad._id, nextReportAt: ad.nextReportAt },
        { $set: { nextReportAt: next } },
      )
      if (claimed.modifiedCount !== 1) continue
      await this.sendReport(ad.id, ad.reportFrequency).catch(async error => {
        console.error(`Campaign report failed for ${ad.id}`, error)
        await AdModel.updateOne({ _id: ad._id }, { $set: { nextReportAt: new Date(Date.now() + 60 * 60 * 1000) } })
      })
    }
    return due.length
  }

  static publicHtml = async (token: string) => {
    const ad = await this.getAdFromToken(token)
    const report = await this.analytics(ad.id, { from: ad.start, to: new Date() })
    const cards = [
      ['Impressions', report.summary.impressions],
      ['Unique viewers', report.summary.uniqueViewers],
      ['Clicks', report.summary.clicks],
      ['CTR', `${report.summary.ctr}%`],
      ['Video starts', report.summary.videoStarts],
      ['Video completion', `${report.summary.completionRate}%`],
    ].map(([label, value]) => `<div class="card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('')
    const placements = report.placements.map(row => `<tr><td>${escapeHtml(row.placement)}</td><td>${row.impressions}</td><td>${row.clicks}</td><td>${row.ctr}%</td><td>${row.completions}</td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>${escapeHtml(ad.title)} analytics</title><style>body{margin:0;background:#090b10;color:#f8fafc;font-family:Inter,Arial,sans-serif}.wrap{max-width:1000px;margin:auto;padding:32px 20px}.brand{color:#ef4444;font-size:13px;text-transform:uppercase;letter-spacing:.16em}.head{display:flex;justify-content:space-between;gap:20px;align-items:end}.muted{color:#94a3b8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:28px 0}.card{background:#151922;border:1px solid #252b37;border-radius:16px;padding:20px}.card strong{display:block;font-size:28px}.card span{display:block;color:#94a3b8;margin-top:6px}table{width:100%;border-collapse:collapse;background:#11141b;border-radius:16px;overflow:hidden}th,td{text-align:left;padding:14px;border-bottom:1px solid #252b37}th{color:#94a3b8;font-size:12px;text-transform:uppercase}.status{display:inline-block;padding:7px 11px;border-radius:999px;background:#163d2a;color:#6ee7b7;font-size:12px}@media(max-width:600px){.head{display:block}table{font-size:13px}}</style></head><body><main class="wrap"><div class="head"><div><div class="brand">Reeplay campaign analytics</div><h1>${escapeHtml(ad.title)}</h1><p class="muted">${escapeHtml(ad.brand)} · Updated ${new Date().toLocaleString('en-NG', { timeZone: ad.reportTimezone })}</p></div><span class="status">Live data · refreshes every minute</span></div><section class="grid">${cards}</section><h2>Placement performance</h2><table><thead><tr><th>Placement</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Completions</th></tr></thead><tbody>${placements || '<tr><td colspan="5" class="muted">Analytics will appear after the campaign begins receiving impressions.</td></tr>'}</tbody></table><p class="muted" style="margin-top:28px;font-size:12px">This private, read-only report contains aggregate campaign data and no customer identities.</p></main></body></html>`
  }
}
