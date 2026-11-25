import 'dotenv/config'

const NUMERIC_REG = /^\d+$/

const setToNumberWithDefault = (key: string, defaultNum: number) => {
  const val = process.env[key]
  if (val == null) return defaultNum

  if (!NUMERIC_REG.test(val)) {
    throw new Error(`optional env variable ${key} must be numeric if present`)
  }

  return Number(val)
}

const setToBooleanWithDefault = (key: string, defaultValue: boolean) => {
  const val = process.env[key]
  if (val == null) return defaultValue

  if (!['true', 'false'].includes(val.toLowerCase())) {
    throw new Error(`optional env variable ${key} must be true or false if present`)
  }

  return val.toLowerCase() === 'true'
}

const getValidEnv = <T extends Record<string, any>>(variables: Partial<T>) => {
  Object.entries(variables).forEach(([key, val]) => {
    if (val === undefined) {
      throw new Error(`${key} is missing from env file`)
    }
  })

  return variables as Required<T>
}

export const env = getValidEnv({
  //
  PORT: process.env.PORT,
  MONGO_DB_URL: process.env.MONGO_DB_URL,
  MONGO_DB_NAME: process.env.MONGO_DB_NAME ?? 'reeplayDB',
  NODE_ENV: process.env.NODE_ENV,
  ENABLE_CRON: setToBooleanWithDefault('ENABLE_CRON', false),
  PUBLIC_APP_ORIGIN:
    process.env.PUBLIC_APP_ORIGIN ??
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'https://reeplay-api-ts-production.up.railway.app'),

  // emails
  MAIL_SENDER: process.env.MAIL_SENDER,
  MAIL_HOST: process.env.MAIL_HOST,
  MAIL_USER: process.env.MAIL_USER,
  MAIL_PASSWORD: process.env.MAIL_PASSWORD,
  MAIL_PORT: setToNumberWithDefault('MAIL_PORT', 465),

  //   secrets
  JWT_SECRET: process.env.JWT_SECRET,
  GUEST_TOKEN: process.env.GUEST_TOKEN,
  JWT_SECRET_REFRESH_TOKEN: process.env.JWT_SECRET_REFRESH_TOKEN,
  FIREBASE_SERVICE_ACCOUNT_BASE64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,

  // flutterwave  secrets
  FLUTTERWAVE_SECRET_KEY: process.env.FLUTTERWAVE_SECRET_KEY,
  FLUTTERWAVE_PUBLIC_KEY: process.env.FLUTTERWAVE_PUBLIC_KEY,
  FLUTTERWAVE_SECRET_HASH: process.env.FLUTTERWAVE_SECRET_HASH,
  FLUTTERWAVE_ENCYPTION_KEY: process.env.FLUTTERWAVE_ENCYPTION_KEY,

  // AWS
  S3REGION: process.env.S3REGION,
  S3SECRET_KEY: process.env.S3SECRET_KEY,
  S3ACCESS_KEY: process.env.S3ACCESS_KEY,
  IAM_ROLE_ARN: process.env.IAM_ROLE_ARN,
  RAILWAY_MEDIACONVERT_QUEUE_ARN: process.env.RAILWAY_MEDIACONVERT_QUEUE_ARN ?? '',
  RAILWAY_MEDIACONVERT_JOB_TEMPLATE: process.env.RAILWAY_MEDIACONVERT_JOB_TEMPLATE ?? '',
  CDN_IMAGES_BASE_URL: process.env.CDN_IMAGES_BASE_URL,

  S3_IMAGE_BUCKET: process.env.S3_IMAGE_BUCKET,

  get S3_VIDEO_BUCKET() {
    return process.env.S3BUCKET
  },

  // new

  // media
  KEY_PAIR_ID: process.env.KEY_PAIR_ID,
  CFS_PRIVATE_KEY: process.env.CFS_PRIVATE_KEY,
  CFSDISTRIBUTION: process.env.CFSDISTRIBUTION,

  // *** payments
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
  WAVE_API_KEY: process.env.WAVE_API_KEY,

  // *** charges
  EVENT_HOURLY_CHARGES_NGN: setToNumberWithDefault('EVENT_HOURLY_CHARGES_NGN', 10000),
  EVENT_HOURLY_CHARGES_USD: setToNumberWithDefault('EVENT_HOURLY_CHARGES_USD', 10),
  MIN_WITHDRAWAL_AMOUNT_USD: setToNumberWithDefault('MIN_WITHDRAWAL_AMOUNT_USD', 50000),
  MIN_WITHDRAWAL_AMOUNT_NGN: setToNumberWithDefault('MIN_WITHDRAWAL_AMOUNT_NGN', 50000),
  PAYOUT_SERVICE_CHARGE: setToNumberWithDefault('PAYOUT_SERVICE_CHARGE', 15),
  PREMIUM_MOVIE_PRICE_USD: setToNumberWithDefault('PREMIUM_MOVIE_PRICE_USD_CENTS', 59) / 100,
  PREMIUM_SEASON_PRICE_USD: setToNumberWithDefault('PREMIUM_SEASON_PRICE_USD_CENTS', 159) / 100,
  CONTENT_ACCESS_DAYS: setToNumberWithDefault('CONTENT_ACCESS_DAYS', 30),
  APPLE_MOVIE_PRODUCT_ID:
    process.env.APPLE_MOVIE_PRODUCT_ID ?? 'app.reeplay.ppv.movie.30d',
  APPLE_SEASON_PRODUCT_ID:
    process.env.APPLE_SEASON_PRODUCT_ID ?? 'app.reeplay.ppv.season.30d',
  GOOGLE_MOVIE_PRODUCT_ID:
    process.env.GOOGLE_MOVIE_PRODUCT_ID ?? 'reeplay_ppv_movie_30d',
  GOOGLE_SEASON_PRODUCT_ID:
    process.env.GOOGLE_SEASON_PRODUCT_ID ?? 'reeplay_ppv_season_30d',
  APPLE_IAP_ISSUER_ID: process.env.APPLE_IAP_ISSUER_ID ?? '',
  APPLE_IAP_KEY_ID: process.env.APPLE_IAP_KEY_ID ?? '',
  APPLE_IAP_PRIVATE_KEY_BASE64: process.env.APPLE_IAP_PRIVATE_KEY_BASE64 ?? '',
  APPLE_BUNDLE_ID: process.env.APPLE_BUNDLE_ID ?? 'com.reeplayv2',
  GOOGLE_PLAY_PACKAGE_NAME: process.env.GOOGLE_PLAY_PACKAGE_NAME ?? 'com.reeplayv2',
  GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64 ?? '',
  GOOGLE_PUBSUB_AUDIENCE: process.env.GOOGLE_PUBSUB_AUDIENCE ?? '',
  GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL:
    process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL ?? '',

  // livestream
  RP_RTMP_APP_NAME: process.env.RP_RTMP_APP_NAME,
  RP_RTMP_BASE_URL: process.env.RP_RTMP_BASE_URL,
  RP_HLS_BASE_URL: process.env.RP_HLS_BASE_URL,
  // RP_RMTP_AUTH_SECRET: process.env.RP_RMTP_AUTH_SECRET,
  // RP_HLS_HTTP_PORT: setToNumberWithDefault('RP_HLS_HTTP_PORT', 8888),
  // RP_RTMP_PORT: setToNumberWithDefault('RP_RTMP_PORT', 1935),

  get RP_RTMP_SERVER_URL() {
    return this.IS_PROD ? this.RP_RTMP_BASE_URL : `rtmp://localhost/live`
  },

  get RP_PLAYBACK_URL() {
    return this.IS_PROD ? this.RP_HLS_BASE_URL : `http://localhost/live/`
  },

  get IS_PROD() {
    return this.NODE_ENV === 'production'
  },
})

export default env
