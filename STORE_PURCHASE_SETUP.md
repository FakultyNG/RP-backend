# Reeplay mobile store purchase setup

The backend treats **USD 0.59 per movie** and **USD 1.59 per season** as the canonical catalogue prices. The app displays the localized price returned by Apple or Google. Access lasts 30 days and an active repurchase extends the current expiry by another 30 days.

## Products

Create consumable one-time products in both stores:

| Store | Movie product | Season product | Reference price |
| --- | --- | --- | --- |
| App Store Connect | `app.reeplay.ppv.movie.30d` | `app.reeplay.ppv.season.30d` | USD 0.59 / USD 1.59 |
| Google Play Console | `reeplay_ppv_movie_30d` | `reeplay_ppv_season_30d` | USD 0.59 / USD 1.59 |

If App Store Connect does not offer those exact price points, select its nearest permitted points. The backend still records the canonical reference prices, while the iOS UI always shows Apple's actual localized price.

## Railway variables

```text
PREMIUM_MOVIE_PRICE_USD_CENTS=59
PREMIUM_SEASON_PRICE_USD_CENTS=159
CONTENT_ACCESS_DAYS=30

APPLE_MOVIE_PRODUCT_ID=app.reeplay.ppv.movie.30d
APPLE_SEASON_PRODUCT_ID=app.reeplay.ppv.season.30d
APPLE_BUNDLE_ID=com.reeplayv2
APPLE_IAP_ISSUER_ID=...
APPLE_IAP_KEY_ID=...
APPLE_IAP_PRIVATE_KEY_BASE64=...

GOOGLE_MOVIE_PRODUCT_ID=reeplay_ppv_movie_30d
GOOGLE_SEASON_PRODUCT_ID=reeplay_ppv_season_30d
GOOGLE_PLAY_PACKAGE_NAME=com.reeplayv2
GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64=...
GOOGLE_PUBSUB_AUDIENCE=https://reeplay-api-ts-production.up.railway.app/api/v1/webhooks/store/google
GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL=reeplay-pubsub-push@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

`APPLE_IAP_PRIVATE_KEY_BASE64` is the base64 encoding of the App Store Connect in-app-purchase private key. `GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64` is the base64 encoding of a Google service-account JSON key that has Android Publisher access to the app.

## Refund notifications

- Apple App Store Server Notifications URL: `https://YOUR_API/api/v1/webhooks/store/apple`
- Google Play Real-time Developer Notifications: publish to a Pub/Sub push subscription targeting `https://YOUR_API/api/v1/webhooks/store/google`

For Google, keep Pub/Sub payload wrapping enabled and enable push authentication. Set the
subscription audience to the exact `GOOGLE_PUBSUB_AUDIENCE` URL and select the service account
whose email is stored in `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL`. If both variables are blank,
the endpoint remains compatible with an unauthenticated subscription while still re-checking each
known transaction with Google Play; configure both variables before production use.

The handlers re-check the transaction with the store before revoking access.

## Existing demo content migration

After deploying the compiled backend, run once:

```bash
npm run migrate:content-access
```

This maps every existing `exclusive` VOD to `premium + isReeplayOriginal`, removes legacy custom pricing, and normalizes legacy ad-class VODs to free. It does not modify users.
