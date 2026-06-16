// Seed data for the Applications catalog, Automation templates, and FleetHub
// marketplace. These are real DB rows (seeded once on first read) — not
// hardcoded UI lists — so they can be edited/extended via the API later.

export const APP_CATALOG = [
  { name: 'TikTok (Global)', packageName: 'com.zhiliaoapp.musically', version: '45.0.3', category: 'Social', shortLabel: 'TT', color: '#111111' },
  { name: 'TikTok (Asia)', packageName: 'com.ss.android.ugc.trill', version: '45.0.3', category: 'Social', shortLabel: 'TT', color: '#111111' },
  { name: 'Instagram', packageName: 'com.instagram.android', version: '433.0.0.42.68', category: 'Social', shortLabel: 'IG', color: '#d6249f' },
  { name: 'Facebook', packageName: 'com.facebook.katana', version: '562.0.0.51.73', category: 'Social', shortLabel: 'FB', color: '#1877f2' },
  { name: 'X (Twitter)', packageName: 'com.twitter.android', version: '11.8.0', category: 'Social', shortLabel: 'X', color: '#1d1d1f' },
  { name: 'YouTube', packageName: 'com.google.android.youtube', version: '20.41.34', category: 'Social', shortLabel: 'YT', color: '#ff0000' },
  { name: 'Reddit', packageName: 'com.reddit.frontpage', version: '2025.41.0', category: 'Social', shortLabel: 'R', color: '#ff4500' },
  { name: 'Pinterest', packageName: 'com.pinterest', version: '13.4.0', category: 'Social', shortLabel: 'P', color: '#e60023' },
  { name: 'WhatsApp', packageName: 'com.whatsapp', version: '2.24.1', category: 'Messaging', shortLabel: 'WA', color: '#25d366' },
  { name: 'Telegram', packageName: 'org.telegram.messenger', version: '11.2.0', category: 'Messaging', shortLabel: 'TG', color: '#2aabee' },
  { name: 'Shopee', packageName: 'com.shopee.id', version: '3.68.41', category: 'Shopping', shortLabel: 'S', color: '#ee4d2d' },
  { name: 'SHEIN', packageName: 'com.zzkko', version: '13.5.0', category: 'Shopping', shortLabel: 'SH', color: '#1d1d1f' },
  { name: 'Seeking', packageName: 'com.seeking.app', version: '5.3', category: 'Lifestyle', shortLabel: 'SK', color: '#e0457b' },
  { name: 'EliteSingles', packageName: 'com.spark.elitesingles', version: '7.6.2', category: 'Lifestyle', shortLabel: 'ES', color: '#5a4fcf' },
  { name: 'Capital One', packageName: 'com.konylabs.capitalone', version: '6.47.6', category: 'Finance', shortLabel: 'C1', color: '#004977' },
  { name: 'Wells Fargo', packageName: 'com.wf.wellsfargomobile', version: '25.12.01.65', category: 'Finance', shortLabel: 'WF', color: '#d71e28' }
];

export const AUTOMATION_TEMPLATES = [
  { title: 'TikTok video posting', description: 'Automatically publish videos to your TikTok account. Batch editing, mentions and tags supported.', platform: 'TikTok', color: '#111111', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.zhiliaoapp.musically' }, recommended: true },
  { title: 'Publish YouTube Shorts', description: 'Batch publish YouTube Shorts using video URLs to improve operational efficiency.', platform: 'YouTube', color: '#ff0000', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.google.android.youtube' }, recommended: true },
  { title: 'Post Reels on Instagram', description: 'Publish short Reels with one click on Instagram to improve operational efficiency.', platform: 'Instagram', color: '#d6249f', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.instagram.android' }, recommended: true },
  { title: 'Publish video on Reddit', description: 'Publish video content to improve operational efficiency.', platform: 'Reddit', color: '#ff4500', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.reddit.frontpage' }, recommended: true },
  { title: 'Delete all TikTok videos', description: 'Remove all videos from your account in one click, quickly resetting your channel.', platform: 'TikTok', color: '#111111', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.zhiliaoapp.musically' }, recommended: false },
  { title: 'Hide all TikTok videos', description: 'Keep pinned videos while setting all others to private in bulk.', platform: 'TikTok', color: '#111111', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.zhiliaoapp.musically' }, recommended: false },
  { title: 'Random follow on TikTok', description: 'Browse videos and follow users based on custom probability to increase visibility.', platform: 'TikTok', color: '#111111', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.zhiliaoapp.musically' }, recommended: false },
  { title: 'Send private message on TikTok', description: 'Search for usernames and send private messages in bulk.', platform: 'TikTok', color: '#111111', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.zhiliaoapp.musically' }, recommended: false },
  { title: 'TikTok account warmup', description: 'Simulate human actions. Each action item is paired with an interval to stay natural.', platform: 'TikTok', color: '#111111', jobType: 'EMULATOR_OPEN_APP' as const, payload: { packageName: 'com.zhiliaoapp.musically' }, recommended: false }
];

export const MARKETPLACE_LISTINGS = [
  { title: 'Warm-up Routine', category: 'TEMPLATE' as const, icon: '◫', description: 'Auto-scrolls feeds and likes to age fresh accounts naturally.', price: 'Free', installs: 1200 },
  { title: 'Bulk Account Creator', category: 'AUTOMATION' as const, icon: '✦', description: 'Provisions accounts across phones with unique fingerprints.', price: '$19', installs: 840 },
  { title: 'Residential Proxy Pack', category: 'INTEGRATION' as const, icon: '⇄', description: 'Rotating residential IPs across 40+ countries, per-phone binding.', price: '$29/mo', installs: 610 },
  { title: 'TikTok Engager', category: 'AUTOMATION' as const, icon: '▤', description: 'Follows, comments and DMs on a schedule with human-like timing.', price: '$24', installs: 2100 },
  { title: 'Profile Fingerprint Kit', category: 'TEMPLATE' as const, icon: '◈', description: 'Realistic device, locale and sensor profiles to avoid detection.', price: 'Free', installs: 3400 },
  { title: 'Cookie Importer', category: 'INTEGRATION' as const, icon: '❏', description: 'Bulk-imports session cookies into matching cloud phones.', price: '$9', installs: 430 }
];
