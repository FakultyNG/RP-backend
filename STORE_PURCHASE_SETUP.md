# Reeplay mobile store purchase setup

The backend treats **USD 0.30 per movie** and **USD 0.80 per season** as the canonical catalogue prices. The app displays the localized price returned by Apple or Google. Access lasts 30 days and an active repurchase extends the current expiry by another 30 days.

## Products

Create consumable one-time products in both stores:

| Store | Movie product | Season product | Reference price |
| --- | --- | --- | --- |
| App Store Connect | `app.reeplay.ppv.movie.30d` | `app.reeplay.ppv.season.30d` | USD 0.30 / USD 0.80 |
| Google Play Console | `reeplay_ppv_movie_30d` | `reeplay_ppv_season_30d` | USD 0.30 / USD 0.80 |

If App Store Connect does not offer those exact price points, select its nearest permitted points. The backend still records the canonical reference prices, while the iOS UI always shows Apple's actual localized price.

## Railway variables

```text
PREMIUM_MOVIE_PRICE_USD_CENTS=30
PREMIUM_SEASON_PRICE_USD_CENTS=80
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
```

`APPLE_IAP_PRIVATE_KEY_BASE64` is the base64 encoding of the App Store Connect in-app-purchase private key. `GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64` is the base64 encoding of a Google service-account JSON key that has Android Publisher access to the app.

## Refund notifications

- Apple App Store Server Notifications URL: `https://YOUR_API/api/v1/webhooks/store/apple`
- Google Play Real-time Developer Notifications: publish to a Pub/Sub push subscription targeting `https://YOUR_API/api/v1/webhooks/store/google`

The handlers re-check the transaction with the store before revoking access.

## Existing demo content migration

After deploying the compiled backend, run once:

```bash
npm run migrate:content-access
```

This maps every existing `exclusive` VOD to `premium + isReeplayOriginal`, removes legacy custom pricing, and normalizes legacy ad-class VODs to free. It does not modify users.
