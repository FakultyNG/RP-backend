import { Request, Response } from 'express'
import mongoose from 'mongoose'
import env from '../../env'
import { CastEnumModel } from '../../models/castEnum.model'
import { LiveModel } from '../../models/lives.model'
import { VideoModel } from '../../models/videos.model'
import { MediaAccess } from '../../services/media-access'
import { OperationalError } from '../../utils/OperationalError'

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const safeDescription = (value: unknown) => {
  const description = String(value ?? 'Discover and watch this content on Reeplay.')
    .replace(/\s+/g, ' ')
    .trim()
  return description.slice(0, 240)
}

export class SharePageController {
  static render = async (req: Request, res: Response) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw new OperationalError('Shared content not found', 404)

    const requestedType = req.params.type.toLowerCase()
    let title = ''
    let description = ''
    let image = ''
    let canonicalType = requestedType

    if (requestedType === 'cast') {
      const cast = await CastEnumModel.findById(id).lean()
      if (!cast) throw new OperationalError('Cast profile not found', 404)
      title = cast.name
      description = safeDescription(cast.description)
      image = MediaAccess.getImageAndSubtitleURL(cast.key)
    } else if (requestedType === 'live') {
      const live = await LiveModel.findById(id).lean()
      if (!live) throw new OperationalError('Live content not found', 404)
      title = live.title
      description = safeDescription(live.description)
      image = MediaAccess.getImageAndSubtitleURL(live.coverPhoto.Key)
    } else if (['vod', 'movie', 'series', 'music-video', 'skit'].includes(requestedType)) {
      const video = await VideoModel.findById(id).lean()
      if (!video || !video.active) throw new OperationalError('Content not found', 404)
      title = video.title
      description = safeDescription(video.description)
      image = MediaAccess.getImageAndSubtitleURL(video.landscapePhoto.Key)
      canonicalType = video.type
    } else {
      throw new OperationalError('Unsupported shared content type', 400)
    }

    const vodId =
      typeof req.query.vodId === 'string' && mongoose.isValidObjectId(req.query.vodId)
        ? req.query.vodId
        : ''
    const query = vodId ? `?vodId=${encodeURIComponent(vodId)}` : ''
    const canonicalUrl = `${env.PUBLIC_SHARE_ORIGIN}/share/${encodeURIComponent(canonicalType)}/${id}${query}`
    const deepLink = `reeplay://share/${encodeURIComponent(canonicalType)}/${id}${query}`
    const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.reeplayv2'
    const pageTitle = `${title} · Reeplay`

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:site_name" content="Reeplay" />
  <meta property="og:type" content="video.other" />
  <meta property="og:title" content="${escapeHtml(pageTitle)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    *{box-sizing:border-box} body{margin:0;min-height:100svh;background:#090b10;color:#fff;display:grid;place-items:center;padding:24px}
    main{width:min(100%,520px);overflow:hidden;border:1px solid #252934;border-radius:22px;background:#12151d;box-shadow:0 28px 80px #0008}
    img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#1b1e27}
    section{padding:24px} small{color:#ff4a4a;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
    h1{font-size:clamp(1.55rem,6vw,2.2rem);line-height:1.1;margin:10px 0 12px} p{color:#aeb4c2;line-height:1.6;margin:0 0 22px}
    a{display:flex;min-height:50px;align-items:center;justify-content:center;border-radius:13px;text-decoration:none;font-weight:700}
    .primary{background:#f33d44;color:#fff}.secondary{margin-top:10px;border:1px solid #303541;color:#d8dbe3}
  </style>
</head>
<body>
  <main>
    <img src="${escapeHtml(image)}" alt="" />
    <section>
      <small>Watch on Reeplay</small>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <a class="primary" href="${escapeHtml(deepLink)}">Open in Reeplay</a>
      <a class="secondary" href="${playStoreUrl}">Get Reeplay for Android</a>
    </section>
  </main>
</body>
</html>`)
  }
}
