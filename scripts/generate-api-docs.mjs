import fs from 'node:fs'
import path from 'node:path'

const productionUrl = 'https://reeplay-api-ts-production.up.railway.app'
const apiPrefix = '/api/v1'

const endpoints = []
const add = (surface, security, rows) => {
  for (const [method, route, summary, options = {}] of rows) {
    endpoints.push({ surface, security, method: method.toLowerCase(), path: route, summary, ...options })
  }
}

const customerShared = [
  ['GET', '/shared/subtitles/fetch/:parentId/:type', 'Fetch subtitles'],
  ['PUT', '/shared/user-profile/update/:userId', 'Update user profile', { multipart: true, schema: 'UserProfileUpdate' }],
  ['POST', '/shared/initiate-payment', 'Initiate payment', { schema: 'InitiatePayment' }],
  ['POST', '/shared/authorize-payment', 'Authorize wallet payment', { schema: 'AuthorizePayment' }],
  ['GET', '/shared/payment-history', 'Fetch payment history'],
  ['GET', '/shared/wallet', 'Fetch wallet'],
  ['PUT', '/shared/should-store/:paymentId', 'Set whether payment details should be stored'],
  ['GET', '/shared/payment-details', 'Fetch saved payment details'],
  ['GET', '/shared/content-costs', 'Check content costs'],
  ['GET', '/shared/check-content-payment/:contentType/:contentId', 'Check payment for content'],
  ['GET', '/shared/vods/suggestions', 'Fetch VOD suggestions'],
  ['GET', '/shared/vods/top-10', 'Fetch the ordered home Top 10'],
  ['GET', '/shared/vods/category/:catId', 'Fetch VODs by category'],
  ['GET', '/shared/vods/similar-by-cast/:castId', 'Fetch similar VODs by cast'],
  ['GET', '/shared/vods/seasons/:vidId', 'Fetch seasons and episodes'],
  ['GET', '/shared/vods/similar-by-genre/:genreId', 'Fetch similar VODs by genre'],
  ['GET', '/shared/vods/video-source/:videoId/:type', 'Fetch a video source'],
  ['GET', '/shared/vods/vod-meta/:vodId', 'Fetch VOD metadata'],
  ['GET', '/shared/vods/default-library', 'Fetch default VOD library'],
  ['GET', '/shared/vods/categ-and-genre/:genreId/:catId', 'Fetch VODs by category and genre'],
  ['GET', '/shared/featured/contents/search/:text', 'Search featured content'],
  ['GET', '/shared/get-categories', 'Fetch categories'],
  ['GET', '/shared/get-genres', 'Fetch genres'],
  ['GET', '/shared/get-casts', 'Fetch casts'],
  ['GET', '/shared/casts/:castId', 'Fetch cast details'],
]

add('Public and service', null, [
  ['GET', '/', 'API service information'],
  ['GET', '/health', 'Liveness check'],
  ['GET', '/ready', 'Database readiness check'],
  ['POST', `${apiPrefix}/on_publish`, 'RTMP on-publish callback'],
  ['GET', `${apiPrefix}/version`, 'Fetch deployed backend package version'],
  ['POST', `${apiPrefix}/webhooks/paystack`, 'Paystack webhook'],
  ['POST', `${apiPrefix}/webhooks/flutterwave/v3`, 'Flutterwave v3 webhook'],
  ['POST', `${apiPrefix}/webhooks/wave`, 'Wave webhook'],
  ['GET', `${apiPrefix}/merchants/giftcards/many/:currency/:email/:password`, 'Fetch merchant gift cards'],
  ['POST', `${apiPrefix}/merchants/giftcards/notify/:code/:email/:password`, 'Notify that a merchant gift card was used'],
  ['POST', `${apiPrefix}/merchants/giftcards/create`, 'Create merchant credentials', { schema: 'MerchantCreate' }],
])

add('Customer app — public', null, [
  ['POST', `${apiPrefix}/customers/signup`, 'Create customer account', { schema: 'CustomerCreate' }],
  ['POST', `${apiPrefix}/customers/general-signin`, 'Sign in customer', { schema: 'Login' }],
  ['GET', `${apiPrefix}/customers/verification/get-token`, 'Request verification token'],
  ['POST', `${apiPrefix}/customers/signup/verifyaccount`, 'Verify customer account'],
  ['GET', `${apiPrefix}/customers/general/validate-token`, 'Validate access token'],
  ['GET', `${apiPrefix}/customers/general/validate-reftoken`, 'Validate refresh token'],
  ['GET', `${apiPrefix}/customers/general/renew-accesstoken`, 'Renew access token'],
  ['GET', `${apiPrefix}/customers/general/guest-access`, 'Fetch guest-access feature setting'],
  ['POST', `${apiPrefix}/customers/pass-reset/get-token`, 'Request password-reset token'],
  ['POST', `${apiPrefix}/customers/pass-reset/change-pass`, 'Change forgotten password'],
  ['GET', `${apiPrefix}/customers/pin-reset/:email`, 'Reset customer PIN'],
  ['GET', `${apiPrefix}/customers/ads/random`, 'Fetch a random advertisement'],
])

add('Customer app', 'customerAuth', [
  ['POST', `${apiPrefix}/customers/view/content`, 'Record content view', { schema: 'ContentView' }],
  ...customerShared.map(([m, p, s, o]) => [m, `${apiPrefix}/customers${p}`, s, o]),
  ['GET', `${apiPrefix}/customers/profile/fetch`, 'Fetch customer profile'],
  ['DELETE', `${apiPrefix}/customers/profile/delete`, 'Delete customer profile'],
  ['GET', `${apiPrefix}/customers/upcoming/events/fetch`, 'Fetch upcoming events', { query: ['page', 'limit'] }],
  ['GET', `${apiPrefix}/customers/upcoming/events/is-subscribed/:id/:contentType`, 'Check upcoming-event subscription'],
  ['PUT', `${apiPrefix}/customers/upcoming/events/subscribe/:id/:contentType`, 'Subscribe to an upcoming event'],
  ['PUT', `${apiPrefix}/customers/upcoming/events/unsubscribe/:id/:contentType`, 'Unsubscribe from an upcoming event'],
  ['PUT', `${apiPrefix}/customers/settings/notification-vidquality`, 'Update notification and video-quality settings'],
  ['POST', `${apiPrefix}/customers/settings/watchlist/add`, 'Add item to watchlist'],
  ['POST', `${apiPrefix}/customers/settings/watchlist/rem`, 'Remove item from watchlist'],
  ['POST', `${apiPrefix}/customers/settings/interest/add`, 'Add customer interest'],
  ['POST', `${apiPrefix}/customers/ratings/create`, 'Create rating', { schema: 'RatingCreate' }],
  ['GET', `${apiPrefix}/customers/ratings/fetch/:parentId`, 'Fetch ratings'],
  ['PUT', `${apiPrefix}/customers/ratings/:ratingId`, 'Update rating', { schema: 'RatingUpdate' }],
  ['DELETE', `${apiPrefix}/customers/ratings/:ratingId`, 'Delete rating'],
  ['PUT', `${apiPrefix}/customers/socials/create-update/reaction/:commentId/:reaction`, 'Create or update reaction'],
  ['DELETE', `${apiPrefix}/customers/socials/delete/reaction/:reactionId`, 'Delete reaction'],
  ['POST', `${apiPrefix}/customers/socials/create/comment`, 'Create comment', { schema: 'CommentCreate' }],
  ['POST', `${apiPrefix}/customers/socials/create/reply`, 'Create reply', { schema: 'ReplyCreate' }],
  ['GET', `${apiPrefix}/customers/socials/fetch/comments/:parentId`, 'Fetch comments'],
  ['GET', `${apiPrefix}/customers/socials/fetch/total-comments/:parentId`, 'Fetch comment count'],
  ['GET', `${apiPrefix}/customers/socials/fetch/replies/:commentId`, 'Fetch replies'],
  ['PUT', `${apiPrefix}/customers/socials/comments/:commentId`, 'Update comment', { schema: 'CommentUpdate' }],
  ['DELETE', `${apiPrefix}/customers/socials/comments/:commentId`, 'Delete comment'],
  ['POST', `${apiPrefix}/customers/media/vod-streaming/:vidUploadId`, 'Get VOD streaming URL'],
  ['GET', `${apiPrefix}/customers/media/vod/fetch/featured`, 'Fetch featured VODs'],
  ['POST', `${apiPrefix}/customers/media/vod/like/:id`, 'Like VOD'],
  ['GET', `${apiPrefix}/customers/media/vod/userliked/:id`, 'Check whether customer liked VOD'],
  ['POST', `${apiPrefix}/customers/media/vod/unlike/:id`, 'Unlike VOD'],
  ['GET', `${apiPrefix}/customers/enums/shared/get-categories`, 'Fetch categories through enums router'],
  ['GET', `${apiPrefix}/customers/enums/shared/get-genres`, 'Fetch genres through enums router'],
  ['GET', `${apiPrefix}/customers/enums/shared/get-casts`, 'Fetch casts through enums router'],
  ['GET', `${apiPrefix}/customers/enums/shared/casts/:castId`, 'Fetch cast through enums router'],
  ...[
    ['all', 'all live events'], ['featured', 'featured live events'], ['sponsored', 'sponsored live events'],
    ['channels', 'channels'], ['pop/channels', 'popular channels'], ['events', 'events'],
    ['pop/events', 'popular events'], ['tvshows', 'TV shows'], ['pop/tvshows', 'popular TV shows'],
    ['sports', 'sports'], ['pop/sports', 'popular sports'], ['podcasts', 'podcasts'],
    ['pop/podcasts', 'popular podcasts'],
  ].map(([p, s]) => ['GET', `${apiPrefix}/customers/live/events/fetch/${p}`, `Fetch ${s}`]),
  ['GET', `${apiPrefix}/customers/live/events/stream/:id`, 'Stream live event'],
  ['GET', `${apiPrefix}/customers/livestream/vote/fetch-info`, 'Fetch voting information'],
  ['GET', `${apiPrefix}/customers/livestream/vote/fetch-contestants`, 'Fetch voting contestants'],
  ['GET', `${apiPrefix}/customers/subscription/fetch-plans`, 'Fetch subscription plans'],
  ['POST', `${apiPrefix}/customers/subscription/create`, 'Create subscription'],
  ['GET', `${apiPrefix}/customers/subscription/status`, 'Fetch customer subscription status'],
  ['POST', `${apiPrefix}/customers/notification/device/register`, 'Register device token'],
  ['POST', `${apiPrefix}/customers/notification/device/update`, 'Update device token'],
  ['DELETE', `${apiPrefix}/customers/notification/device/remove`, 'Remove device token'],
  ['POST', `${apiPrefix}/customers/recent-search/register`, 'Register recent search', { schema: 'RecentSearchCreate' }],
  ['GET', `${apiPrefix}/customers/recent-search/fetch`, 'Fetch recent searches'],
  ['POST', `${apiPrefix}/customers/watched/register`, 'Register watched progress', { schema: 'WatchedCreate' }],
  ['GET', `${apiPrefix}/customers/watched/continue-watching`, 'Fetch continue-watching list'],
  ['DELETE', `${apiPrefix}/customers/watched/:id`, 'Delete watched entry'],
  ['GET', `${apiPrefix}/customers/vod-waitlist/`, 'Fetch VOD waitlist'],
  ['DELETE', `${apiPrefix}/customers/vod-waitlist/`, 'Clear VOD waitlist'],
  ['POST', `${apiPrefix}/customers/vod-waitlist/:videoId`, 'Add VOD to waitlist'],
  ['DELETE', `${apiPrefix}/customers/vod-waitlist/:videoId`, 'Remove VOD from waitlist'],
  ['GET', `${apiPrefix}/customers/vod-waitlist/:videoId`, 'Check VOD waitlist membership'],
  ['GET', `${apiPrefix}/customers/notifications/`, 'Fetch unseen notifications'],
  ['PUT', `${apiPrefix}/customers/notifications/`, 'Mark notifications as seen'],
  ['GET', `${apiPrefix}/customers/giftcard/redeem`, 'Redeem gift card'],
  ['GET', `${apiPrefix}/customers/banner/contents`, 'Fetch banner contents'],
  ['POST', `${apiPrefix}/customers/signup/createpin`, 'Create customer PIN'],
  ['POST', `${apiPrefix}/customers/suggestion/create`, 'Create customer suggestion'],
])

const clientShared = [
  ['POST', '/shared/lives/create', 'Create live event', { multipart: true }],
  ['PUT', '/shared/lives/update-media/:liveId', 'Update live-event media', { multipart: true }],
  ['PUT', '/shared/lives/update-active/:liveId', 'Update live-event active status'],
  ['GET', '/shared/lives/estimate', 'Estimate live-event charges'],
  ['DELETE', '/shared/lives/delete/:liveId', 'Delete live event'],
  ['PUT', '/shared/user-profile/update/:userId', 'Update client profile', { multipart: true, schema: 'UserProfileUpdate' }],
  ['GET', '/shared/payment-history', 'Fetch payment history'], ['GET', '/shared/wallet', 'Fetch wallet'],
  ['PUT', '/shared/should-store/:paymentId', 'Set whether payment details should be stored'],
  ['GET', '/shared/payment-details', 'Fetch saved payment details'], ['GET', '/shared/content-costs', 'Check content costs'],
  ['GET', '/shared/check-content-payment/:contentType/:contentId', 'Check payment for content'],
  ['GET', '/shared/get-categories', 'Fetch categories'], ['GET', '/shared/get-genres', 'Fetch genres'],
  ['GET', '/shared/get-casts', 'Fetch casts'], ['GET', '/shared/casts/:castId', 'Fetch cast details'],
  ['POST', '/shared/initiate-payment', 'Initiate payment', { schema: 'InitiatePayment' }],
  ['POST', '/shared/authorize-payment', 'Authorize wallet payment', { schema: 'AuthorizePayment' }],
  ['GET', '/shared/vid-upload/isready/:id', 'Check video transcoding status'],
]

add('Client/creator', 'clientAuth', [
  ...clientShared.map(([m, p, s, o]) => [m, `${apiPrefix}/clients${p}`, s, o]),
  ['GET', `${apiPrefix}/clients/livestream/streamkey`, 'Fetch livestream credentials'],
  ['POST', `${apiPrefix}/clients/livestream/vote/info`, 'Create vote information'],
  ['PUT', `${apiPrefix}/clients/livestream/vote/info/update`, 'Update vote information'],
  ['GET', `${apiPrefix}/clients/livestream/vote/contestant/fetch`, 'Fetch vote contestants'],
  ['POST', `${apiPrefix}/clients/livestream/vote/contestant`, 'Add vote contestant', { multipart: true, schema: 'ContestantCreate' }],
  ['POST', `${apiPrefix}/clients/livestream/vote/contestant/remove`, 'Remove vote contestant'],
  ['GET', `${apiPrefix}/clients/livestream/vote/voting-status`, 'Fetch voting status'],
  ['POST', `${apiPrefix}/clients/payouts/payment/request`, 'Request payout'],
  ['POST', `${apiPrefix}/clients/payouts/payment/list-banks/:currency`, 'List payout banks'],
  ['GET', `${apiPrefix}/clients/payouts/payment/request/his`, 'Fetch payout request history'],
  ['GET', `${apiPrefix}/clients/payouts/payment/request/group`, 'Group payout requests'],
  ['GET', `${apiPrefix}/clients/event/payment/estimate`, 'Estimate event payment'],
  ['GET', `${apiPrefix}/clients/profile/fetch`, 'Fetch client profile'],
  ['POST', `${apiPrefix}/clients/notifications/create`, 'Create client notification'],
  ['GET', `${apiPrefix}/clients/history/payment/fetch`, 'Fetch client payment history'],
])

const superShared = [
  ...clientShared.slice(0, 5),
  ['GET', '/shared/subtitles/fetch/:parentId/:type', 'Fetch subtitles'],
  ...clientShared.slice(5, 18),
  ...customerShared.slice(10, 20),
  ['GET', '/shared/vid-upload/isready/:id', 'Check video transcoding status'],
]

add('Superadmin — public', null, [
  ['POST', `${apiPrefix}/superadmin/auth/login`, 'Sign in superadmin', { schema: 'Login' }],
])

add('Superadmin', 'superadminAuth', [
  ['POST', `${apiPrefix}/superadmin/client-redirect/login`, 'Force sign in as client'],
  ['GET', `${apiPrefix}/superadmin/platform-settings/guest-access`, 'Fetch guest-access feature setting'],
  ['PUT', `${apiPrefix}/superadmin/platform-settings/guest-access`, 'Enable or disable guest access', { schema: 'GuestAccessSetting' }],
  ...superShared.map(([m, p, s, o]) => [m, `${apiPrefix}/superadmin${p}`, s, o]),
  ['GET', `${apiPrefix}/superadmin/clients/allfetch`, 'Fetch all clients'],
  ['GET', `${apiPrefix}/superadmin/clients/onefetch/:id`, 'Fetch one client'],
  ['GET', `${apiPrefix}/superadmin/clients/deposits`, 'Fetch client deposits'],
  ['GET', `${apiPrefix}/superadmin/enums/shared/get-categories`, 'Fetch categories through enums router'],
  ['GET', `${apiPrefix}/superadmin/enums/shared/get-genres`, 'Fetch genres through enums router'],
  ['GET', `${apiPrefix}/superadmin/enums/shared/get-casts`, 'Fetch casts through enums router'],
  ['GET', `${apiPrefix}/superadmin/enums/shared/casts/:castId`, 'Fetch cast through enums router'],
  ['POST', `${apiPrefix}/superadmin/enums/add-genre`, 'Add genre', { schema: 'GenreCreate' }],
  ['DELETE', `${apiPrefix}/superadmin/enums/rem-genre/:id`, 'Remove genre'],
  ['PUT', `${apiPrefix}/superadmin/enums/update-genre/:genreId`, 'Update genre', { schema: 'GenreCreate' }],
  ['POST', `${apiPrefix}/superadmin/enums/add-category`, 'Add category'],
  ['DELETE', `${apiPrefix}/superadmin/enums/rem-category/:id`, 'Remove category'],
  ['PUT', `${apiPrefix}/superadmin/enums/update-category/:catId`, 'Update category'],
  ['POST', `${apiPrefix}/superadmin/enums/add-cast`, 'Add cast', { multipart: true, schema: 'CastCreate' }],
  ['GET', `${apiPrefix}/superadmin/enums/search-casts/:searchText`, 'Search casts'],
  ['PUT', `${apiPrefix}/superadmin/enums/edit-cast/:castId`, 'Edit cast', { multipart: true, schema: 'CastCreate' }],
  ['DELETE', `${apiPrefix}/superadmin/enums/rem-cast/:id`, 'Remove cast'],
  ['GET', `${apiPrefix}/superadmin/media/read-photo`, 'Create signed photo URL', { schema: 'StorageObject' }],
  ['GET', `${apiPrefix}/superadmin/media/read-subtitle`, 'Create signed subtitle URL', { schema: 'StorageObject' }],
  ['GET', `${apiPrefix}/superadmin/media/read-video/:vidUploadId`, 'Fetch uploaded-video stream'],
  ['POST', `${apiPrefix}/superadmin/media/add-subtitle`, 'Upload subtitle', { multipart: true }],
  ['DELETE', `${apiPrefix}/superadmin/media/delete-subtitle/:id`, 'Delete subtitle'],
  ['GET', `${apiPrefix}/superadmin/lives/search-clients`, 'Search live-event clients'],
  ['GET', `${apiPrefix}/superadmin/lives/all/:type`, 'Fetch live events by type'],
  ['GET', `${apiPrefix}/superadmin/upcoming/event/getall`, 'Fetch all upcoming events', { query: ['page', 'limit'] }],
  ['POST', `${apiPrefix}/superadmin/giftcard/generate/new`, 'Generate gift card', { schema: 'GiftCardCreate' }],
  ['PUT', `${apiPrefix}/superadmin/giftcard/activate/:code/:token`, 'Activate gift card'],
  ['GET', `${apiPrefix}/superadmin/giftcard/generated/fetch`, 'Fetch generated gift cards'],
  ['DELETE', `${apiPrefix}/superadmin/giftcard/:id`, 'Delete gift card'],
  ['GET', `${apiPrefix}/superadmin/payouts/request/all`, 'Fetch all payout requests'],
  ['GET', `${apiPrefix}/superadmin/payouts/request/one/:id`, 'Fetch payout request'],
  ['PUT', `${apiPrefix}/superadmin/payouts/request/status/:id`, 'Update payout status', { schema: 'PayoutStatusUpdate' }],
  ['GET', `${apiPrefix}/superadmin/suggestions/all`, 'Fetch suggestions'],
  ['PUT', `${apiPrefix}/superadmin/suggestions/markread/:id`, 'Mark suggestion read'],
  ['DELETE', `${apiPrefix}/superadmin/suggestions/del/:id`, 'Delete suggestion'],
  ['GET', `${apiPrefix}/superadmin/subscription/plans/fetch`, 'Fetch subscription plans'],
  ['GET', `${apiPrefix}/superadmin/subscription/all/fetch`, 'Fetch subscriptions'],
  ['DELETE', `${apiPrefix}/superadmin/subscription/plans/delete/:id`, 'Delete subscription plan'],
  ['POST', `${apiPrefix}/superadmin/subscription/plans/create`, 'Create subscription plan', { schema: 'PlanCreate' }],
  ['PUT', `${apiPrefix}/superadmin/subscription/plans/update/:id`, 'Update subscription plan', { schema: 'PlanUpdate' }],
  ['GET', `${apiPrefix}/superadmin/featured/contents/fetch`, 'Fetch featured contents'],
  ['POST', `${apiPrefix}/superadmin/featured/contents/add`, 'Add featured content', { schema: 'FeaturedContentCreate' }],
  ['GET', `${apiPrefix}/superadmin/top-10`, 'Fetch the editorial Top 10'],
  ['PUT', `${apiPrefix}/superadmin/top-10`, 'Replace and reorder the editorial Top 10', { schema: 'TopTenReplace' }],
  ['POST', `${apiPrefix}/superadmin/top-10/auto-rank`, 'Rank Top 10 from current engagement data'],
  ['GET', `${apiPrefix}/superadmin/uploads/fetch/:type`, 'Fetch uploaded videos'],
  ['GET', `${apiPrefix}/superadmin/uploads/seasons/fetch/:vidId`, 'Fetch seasons and episodes'],
  ['POST', `${apiPrefix}/superadmin/uploads/video/add/:type`, 'Upload video', { multipart: true }],
  ['GET', `${apiPrefix}/superadmin/uploads/episodes/can-add/:seasonId`, 'Check whether episode can be added'],
  ['GET', `${apiPrefix}/superadmin/uploads/seasons/can-add/:videoId`, 'Check whether season can be added'],
  ['POST', `${apiPrefix}/superadmin/uploads/episodes/add/:seasonId`, 'Add episode', { multipart: true }],
  ['POST', `${apiPrefix}/superadmin/uploads/seasons/add/:videoId`, 'Add season'],
  ['PUT', `${apiPrefix}/superadmin/uploads/edit/:id`, 'Edit video', { multipart: true }],
  ['DELETE', `${apiPrefix}/superadmin/uploads/remove/:id/:type`, 'Delete video'],
  ['GET', `${apiPrefix}/superadmin/user/fetch`, 'Fetch users'],
  ['GET', `${apiPrefix}/superadmin/user/fetch/:userId`, 'Fetch one user'],
  ['POST', `${apiPrefix}/superadmin/user/send-push-notification`, 'Send push notification', { multipart: true, schema: 'PushNotification' }],
  ['DELETE', `${apiPrefix}/superadmin/user/deleteUser/:userId`, 'Delete user'],
  ['GET', `${apiPrefix}/superadmin/dashboard/profile/fetch`, 'Fetch current admin profile'],
  ['PUT', `${apiPrefix}/superadmin/dashboard/profile/edit`, 'Edit current admin profile'],
  ['GET', `${apiPrefix}/superadmin/dashboard/topvideosbytype`, 'Fetch top videos by type'],
  ['GET', `${apiPrefix}/superadmin/dashboard/fetchbalanceandusers`, 'Fetch balances and user counts'],
  ['GET', `${apiPrefix}/superadmin/dashboard/totcontentsandchunks`, 'Fetch content and chunk totals'],
  ['POST', `${apiPrefix}/superadmin/ads/create`, 'Create advertisement', { multipart: true }],
  ['GET', `${apiPrefix}/superadmin/ads/fetchall`, 'Fetch advertisements'],
  ['DELETE', `${apiPrefix}/superadmin/ads/remove/:id`, 'Remove advertisement'],
  ['POST', `${apiPrefix}/superadmin/notifications/create`, 'Create admin notification', { multipart: true }],
  ['POST', `${apiPrefix}/superadmin/create-super-admin`, 'Create superadmin', { multipart: true, schema: 'AdminCreate' }],
  ['POST', `${apiPrefix}/superadmin/create-admin`, 'Create admin', { multipart: true, schema: 'AdminCreate' }],
  ['POST', `${apiPrefix}/superadmin/create-clients`, 'Create client', { multipart: true, schema: 'ClientCreate' }],
])

const schemas = {
  ApiResponse: { type: 'object', properties: { status: { type: 'integer', example: 200 }, message: { type: 'string' }, data: { nullable: true } } },
  Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } } },
  GuestAccessSetting: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean', description: 'When true, unauthenticated users may browse free content with the configured guest token.' } } },
  CustomerCreate: { type: 'object', required: ['name','email','password'], properties: { name:{type:'string',description:'Preferred name (what should we call you?)',maxLength:80}, email:{type:'string',format:'email'}, password:{type:'string',format:'password'} } },
  AdminCreate: { type: 'object', required: ['first_name','last_name','email','password','cpassword','country_code','mobile'], properties: { first_name:{type:'string'}, last_name:{type:'string'}, email:{type:'string',format:'email'}, password:{type:'string',format:'password'}, cpassword:{type:'string',format:'password'}, country_code:{type:'string'}, mobile:{type:'string'}, verified:{type:'boolean'}, gender:{type:'string',enum:['male','female','nil']}, dob:{type:'string',format:'date'}, country:{type:'string'}, image:{type:'string',format:'binary'} } },
  ClientCreate: { allOf: [{ $ref: '#/components/schemas/AdminCreate' }, { type:'object', required:['verified','client_type'], properties:{ client_type:{type:'string',enum:['channel','tvshow','event','podcast']} } }] },
  UserProfileUpdate: { type:'object', properties:{ firstName:{type:'string'}, lastName:{type:'string'}, email:{type:'string',format:'email'}, countryCode:{type:'string'}, mobile:{type:'string'}, password:{type:'string'}, prevPassword:{type:'string'}, gender:{type:'string',enum:['male','female','nil']}, role:{type:'string'}, dob:{type:'string',format:'date'}, country:{type:'string'}, image:{type:'string',format:'binary'} } },
  ContentView: { type:'object', required:['content','contentType'], properties:{ content:{$ref:'#/components/schemas/ObjectId'}, contentType:{type:'string',enum:['vod','episode','live','trailer']} } },
  CommentCreate: { type:'object', required:['message','parentType','parentId'], properties:{ message:{type:'string'}, parentType:{type:'string',enum:['vod','episode']}, parentId:{$ref:'#/components/schemas/ObjectId'} } },
  ReplyCreate: { allOf:[{$ref:'#/components/schemas/CommentCreate'},{type:'object',properties:{parentCommentId:{$ref:'#/components/schemas/ObjectId'},parentReplyId:{$ref:'#/components/schemas/ObjectId'}}}] },
  CommentUpdate: { type:'object', required:['message'], properties:{message:{type:'string'}} },
  RatingCreate: { type:'object', required:['parentType','parentId','rate'], properties:{parentType:{type:'string',enum:['vod','episode']},parentId:{$ref:'#/components/schemas/ObjectId'},rate:{type:'number',minimum:0,maximum:5},comment:{type:'string'}} },
  RatingUpdate: { type:'object', properties:{rate:{type:'number',minimum:0,maximum:5},comment:{type:'string'}} },
  WatchedCreate: { type:'object', required:['parentId','parentType','duration','totalDuration'], properties:{parentId:{$ref:'#/components/schemas/ObjectId'},parentType:{type:'string',enum:['episode','vod']},duration:{type:'number',minimum:0},totalDuration:{type:'number',minimum:0}} },
  RecentSearchCreate: { type:'object', required:['contentId','contentType'], properties:{contentId:{$ref:'#/components/schemas/ObjectId'},contentType:{type:'string',enum:['vod','live']}} },
  InitiatePayment: { type:'object', required:['amount','method','useCase'], properties:{amount:{type:'number'},method:{type:'string',enum:['flutterwave','wallet','wave']},useCase:{type:'string',enum:['subscription','topup','vote','donate','live schedule','live schedule ext','live-watch-exclusive','video-watch-premium','video-watch-exclusive']},fullName:{type:'string'},email:{type:'string',format:'email'},liveId:{$ref:'#/components/schemas/ObjectId'},videoId:{$ref:'#/components/schemas/ObjectId'},voteInfoId:{$ref:'#/components/schemas/ObjectId'},contestantId:{$ref:'#/components/schemas/ObjectId'}} },
  AuthorizePayment: { type:'object', required:['amount','paymentDetailsId'], properties:{amount:{type:'number'},paymentDetailsId:{$ref:'#/components/schemas/ObjectId'}} },
  MerchantCreate: { type:'object', required:['email','password'], properties:{email:{type:'string',format:'email'},password:{type:'string',format:'password'}} },
  ContestantCreate: { type:'object', required:['liveId','names','occupation','bio','contact'], properties:{liveId:{$ref:'#/components/schemas/ObjectId'},names:{type:'string'},occupation:{type:'string'},bio:{type:'string'},contact:{type:'string'},image:{type:'string',format:'binary'}} },
  GenreCreate: { type:'object', required:['name','position'], properties:{name:{type:'string'},position:{type:'number'}} },
  CastCreate: { type:'object', properties:{name:{type:'string'},title:{type:'string'},description:{type:'string'},selectButtonType:{type:'string',enum:['book-now','fan-page']},link:{type:'string'},image:{type:'string',format:'binary'}} },
  StorageObject: { type:'object', required:['bucket','key'], properties:{bucket:{type:'string'},key:{type:'string'}} },
  GiftCardCreate: { type:'object', required:['amount','currency'], properties:{amount:{type:'number',minimum:0},currency:{type:'string'}} },
  PayoutStatusUpdate: { type:'object', required:['status'], properties:{status:{type:'string',enum:['processing','reversed','rejected','completed']}} },
  PlanCreate: { type:'object', required:['title','months','price','details'], properties:{title:{type:'string'},months:{type:'integer',enum:[1,3,6,12]},price:{type:'number',minimum:0},details:{type:'string'}} },
  PlanUpdate: { type:'object', properties:{title:{type:'string'},months:{type:'integer',enum:[1,3,6,12]},price:{type:'number',minimum:0},details:{type:'string'}} },
  FeaturedContentCreate: { type:'object', required:['id','expiry','type'], properties:{id:{$ref:'#/components/schemas/ObjectId'},expiry:{type:'string',format:'date-time'},type:{type:'string',enum:['event','vod']}} },
  TopTenReplace: { type:'object', required:['videoIds'], properties:{videoIds:{type:'array',maxItems:10,uniqueItems:true,items:{$ref:'#/components/schemas/ObjectId'}}} },
  PushNotification: { type:'object', required:['title','body'], properties:{title:{type:'string'},body:{type:'string'},type:{type:'string'},metadata:{oneOf:[{type:'string'},{type:'object'}]},image:{type:'string',format:'binary'}} },
  ObjectId: { type:'string', pattern:'^[0-9A-Fa-f]{24}$', example:'507f1f77bcf86cd799439011' },
  FlexibleBody: { type:'object', additionalProperties:true },
}

const openapiPath = (route) => route.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/$/, '') || '/'
const parameterName = (segment) => segment.slice(1)
const buildOperation = (endpoint) => {
  const pathParams = endpoint.path.split('/').filter((part) => part.startsWith(':')).map((part) => ({
    name: parameterName(part), in: 'path', required: true, schema: { type: 'string' },
  }))
  const queryParams = (endpoint.query || []).map((name) => ({ name, in:'query', required:false, schema:{type:'integer',minimum:1} }))
  const operation = {
    tags: [endpoint.surface], summary: endpoint.summary,
    operationId: `${endpoint.method}_${openapiPath(endpoint.path).replaceAll(/[^a-zA-Z0-9]+/g, '_')}`,
    parameters: [...pathParams, ...queryParams],
    responses: {
      200: { description:'Successful response', content:{'application/json':{schema:{$ref:'#/components/schemas/ApiResponse'}}} },
      400: { description:'Invalid request' }, 401: { description:'Missing or invalid authentication' },
      404: { description:'Resource not found' }, 500: { description:'Server error' },
    },
  }
  if (endpoint.security) operation.security = [{ [endpoint.security]: [] }]
  if (['post','put','patch'].includes(endpoint.method) || endpoint.schema) {
    const contentType = endpoint.multipart ? 'multipart/form-data' : 'application/json'
    operation.requestBody = { required:false, content:{[contentType]:{schema:endpoint.schema ? {$ref:`#/components/schemas/${endpoint.schema}`} : {$ref:'#/components/schemas/FlexibleBody'}}} }
  }
  return operation
}

const paths = {}
for (const endpoint of endpoints) {
  const key = openapiPath(endpoint.path)
  paths[key] ||= {}
  if (paths[key][endpoint.method]) throw new Error(`Duplicate operation: ${endpoint.method.toUpperCase()} ${key}`)
  paths[key][endpoint.method] = buildOperation(endpoint)
}

const spec = {
  openapi:'3.0.3',
  info:{title:'Reeplay API',version:'2.0.2',description:'Contract generated from the active TypeScript Express routers. Role tokens are raw JWT values in role-specific headers; do not prefix them with Bearer.'},
  servers:[{url:productionUrl,description:'Railway production candidate'},{url:'http://localhost:3000',description:'Local development'}],
  tags:[...new Set(endpoints.map(({surface})=>surface))].map((name)=>({name})),
  paths,
  components:{
    securitySchemes:{
      customerAuth:{type:'apiKey',in:'header',name:'customer-auth',description:'Raw customer JWT'},
      clientAuth:{type:'apiKey',in:'header',name:'clients-auth',description:'Raw client JWT'},
      adminAuth:{type:'apiKey',in:'header',name:'admin-auth',description:'Raw admin JWT; the current admin router exposes no operations'},
      superadminAuth:{type:'apiKey',in:'header',name:'superadmin-auth',description:'Raw superadmin JWT'},
    },
    schemas,
  },
}

const grouped = Map.groupBy(endpoints, ({surface}) => surface)
const lines = [
  '# Reeplay API contract', '',
  '> Generated from the active TypeScript backend routes. Do not edit copied versions by hand; update `scripts/generate-api-docs.mjs` and run `npm run docs:generate`.', '',
  '## Environments', '',
  `- Railway: \`${productionUrl}\``, '- Local: `http://localhost:3000`', '- API prefix: `/api/v1`',
  '- Interactive docs: `/api-docs`', '- Machine-readable OpenAPI: `/openapi.json`', '',
  '## Authentication', '',
  '| Surface | Header | Value |', '| --- | --- | --- |',
  '| Customer app | `customer-auth` | Raw JWT (no `Bearer` prefix) |',
  '| Client/creator | `clients-auth` | Raw JWT (no `Bearer` prefix) |',
  '| Admin | `admin-auth` | Raw JWT; no active admin endpoints currently |',
  '| Superadmin | `superadmin-auth` | Raw JWT (no `Bearer` prefix) |', '',
  'The public login endpoint is `POST /api/v1/superadmin/auth/login`. Public customer onboarding, health checks, callbacks, advertisements, and merchant routes do not require these headers.', '',
  '## Response convention', '',
  'Most JSON responses use `status`, `message`, and `data`. Validation failures normally return HTTP 400, authentication failures HTTP 400/401 depending on the legacy controller, missing resources HTTP 404, and unexpected failures HTTP 500.', '',
  '## Request schemas', '',
  'The OpenAPI document contains reusable schemas for authentication, onboarding, profiles, payments, comments, ratings, watched progress, recent searches, plans, gift cards, casts, contestants, payouts, featured content, and push notifications. Multipart upload endpoints are marked `multipart/form-data`. Some legacy controller-only payloads remain intentionally flexible because their routes have no Joi schema.', '',
  '## Endpoint inventory', '',
]
for (const [surface, rows] of grouped) {
  lines.push(`### ${surface}`, '', '| Method | Path | Auth | Purpose |', '| --- | --- | --- | --- |')
  for (const row of rows) lines.push(`| ${row.method.toUpperCase()} | \`${row.path}\` | ${row.security ? `\`${row.security}\`` : 'Public'} | ${row.summary} |`)
  lines.push('')
}
lines.push('## Known contract notes', '',
  '- `/api/v1/admin` currently installs `admin-auth` middleware but defines no handlers.',
  '- Merchant gift-card routes place email/password values in URL path segments. This is legacy behavior and should be replaced before production because URLs may be logged.',
  '- `GET /superadmin/media/read-photo` and `GET /superadmin/media/read-subtitle` currently validate a JSON body. Some clients/proxies do not reliably send GET bodies; migrate these values to query parameters in a versioned change.',
  '- The inactive `customerRoutes/notificationsRouter.ts` is not mounted and is therefore excluded.',
  '- Webhook signature requirements are provider-specific and enforced by controller logic where implemented.', '')

const root = process.cwd()
fs.mkdirSync(path.join(root,'docs'),{recursive:true})
fs.writeFileSync(path.join(root,'docs','openapi.json'),`${JSON.stringify(spec,null,2)}\n`)
fs.writeFileSync(path.join(root,'apicontract.md'),`${lines.join('\n')}\n`)

const copies = [
  path.resolve(root,'..','Reeplay-Admin'),
  path.resolve(root,'..','Reeplay-V2.0.2'),
  path.resolve(root,'..','RP-backend2.0.2'),
]
for (const target of copies) {
  if (!fs.existsSync(target)) continue
  fs.copyFileSync(path.join(root,'apicontract.md'),path.join(target,'apicontract.md'))
  fs.copyFileSync(path.join(root,'docs','openapi.json'),path.join(target,'openapi.json'))
}

console.log(`Generated ${endpoints.length} operations across ${Object.keys(paths).length} paths.`)
