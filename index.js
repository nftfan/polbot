import 'dotenv/config';
import cron from 'node-cron';
import { TwitterApi } from 'twitter-api-v2';

const TG_LINK = "https://t.me/nftfanstokens";
const QUICKBUY_LINK = "https://www.nftfanstoken.com/quickbuynft/";

// NFTFAN amounts in billions/trillions (as strings for tweet formatting)
const AMOUNTS = [
  "5B", "10B", "25B", "50B", "75B", "100B", "200B", "300B", "500B", "700B", "1T"
];
// EVM wallet variants
const WALLET_TERMS = [
  "your 0x wallet",
  "your EVM wallet",
  "$ETH wallet address",
  "$BASE wallet address",
  "$POL wallet address",
  "MetaMask wallet",
  "EVM chain address"
];

const client = new TwitterApi({
  appKey: process.env.X_APP_KEY,
  appSecret: process.env.X_APP_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET
});

// Get a random NFTFAN giveaway amount
function getRandomAmount() {
  return AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
}

// Get a random wallet naming variant
function getRandomWalletTerm() {
  return WALLET_TERMS[Math.floor(Math.random() * WALLET_TERMS.length)];
}

// 30 engaging EVM wallet templates, focused on $NFTFAN
const TEMPLATES = [
  "🚀 Win {amount} $NFTFAN! RT, Like & Follow @nftfanstoken to enter. Drop {wallet} below 👇",
  "💸 Claim {amount} $NFTFAN! Smash RT, tap Like, tag a friend, Follow @nftfanstoken & drop {wallet} to win.",
  "🎁 Mega airdrop: {amount} $NFTFAN! Follow @nftfanstoken + RT! Drop {wallet} address.",
  "🔥 GIVEAWAY: Win {amount} $NFTFAN – RT, Like & Follow @nftfanstoken. Share your {wallet} in reply!",
  "💎 Huge $NFTFAN drop! Get {amount} $NFTFAN: RT, Like & Follow. Paste your {wallet} address below.",
  "🏆 RT, Like, Follow @nftfanstoken for {amount} $NFTFAN! Drop your {wallet} for a chance.",
  "🥳 Party airdrop: {amount} $NFTFAN – RT, Like, Follow @nftfanstoken, and drop your {wallet}.",
  "⚡ Flash $NFTFAN giveaway! Win {amount} tokens – RT, Like, Follow @nftfanstoken & reply with {wallet}!",
  "🟢 $NFTFAN for everyone! Win {amount}: RT + Like + Follow, then comment your {wallet} address.",
  "🤩 Want {amount} $NFTFAN? RT, Like, Follow @nftfanstoken & drop a valid {wallet} address.",
  "🌐 Ready for {amount} $NFTFAN? RT, Like, Follow @nftfanstoken, drop {wallet} in comments – good luck!",
  `🚀 Double bonus: Win {amount} $NFTFAN + join TG: ${TG_LINK} RT, Like, Follow, leave {wallet}!`,
  `💰 $NFTFAN Pre-Sale: ${QUICKBUY_LINK} 🛒 Win {amount} $NFTFAN by RT, Like, Follow, drop {wallet}!`,
  "🎊 Want $NFTFAN? RT, Like, Follow @nftfanstoken. Drop your {wallet} for a shot at {amount} tokens!",
  "💥 $NFTFAN blast! {amount} tokens giveaway! RT, Like, Follow @nftfanstoken, paste {wallet} below.",
  `🎉 Airdrop: Win {amount} $NFTFAN. Join our TG: ${TG_LINK} RT, Like, Follow & paste {wallet}.`,
  `👑 Want {amount} $NFTFAN + alpha? RT, Like, Follow @nftfanstoken & drop your {wallet} address now!`,
  "Drop {wallet}, then RT, Like, Follow @nftfanstoken to win {amount} $NFTFAN!",
  "Who will win {amount} $NFTFAN? Drop {wallet}, RT, Like & Follow for a shot.",
  "Claim {amount} $NFTFAN airdrop! Like, RT, Follow & share your {wallet}.",
  `🚨 $NFTFAN Pre-sale live: ${QUICKBUY_LINK} RT, Like, Follow, share {wallet} for {amount} tokens!`,
  "Get ready! {amount} $NFTFAN for lucky fans. RT, Like, Follow & drop your {wallet}!",
  `👀 Eyes here: Win {amount} $NFTFAN by joining TG ${TG_LINK}, RT, Like, Follow & drop {wallet}!`,
  "Don’t miss out on {amount} $NFTFAN giveaway! RT, Like, Follow & drop your {wallet} address.",
  "All you need: RT, Like, Follow @nftfanstoken & comment {wallet} for {amount} $NFTFAN.",
  "💚 Spread $NFTFAN love: {amount} token airdrop! RT, Like, Follow & leave your {wallet}.",
  "Drop your {wallet} for a chance at winning {amount} $NFTFAN. RT, Like, Follow @nftfanstoken!",
  `🏅 $NFTFAN boost: Win {amount}! Pre-sale at ${QUICKBUY_LINK}. RT, Like, Follow, drop {wallet}.`,
  "Airdrop celebration! Win {amount} $NFTFAN: Like, RT, Follow, comment your {wallet}.",
  `🤑 $NFTFAN everywhere: Win {amount} tokens. Join TG ${TG_LINK}, RT, Like, Follow, drop {wallet}!`,
];

function getRandomTweetText() {
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const amount = getRandomAmount();
  const wallet = getRandomWalletTerm();
  return template.replace(/\{amount\}/g, amount).replace(/\{wallet\}/g, wallet);
}

async function postTweet() {
  try {
    const text = getRandomTweetText();
    const { data } = await client.v2.tweet(text);
    console.log(`[${new Date().toISOString()}] Tweeted: ${data.text} (ID: ${data.id})`);
  } catch (error) {
    console.error('Tweet failed:', error);
  }
}

// Post immediately on launch
postTweet();

// Every hour on the hour
cron.schedule('0 * * * *', () => {
  postTweet();
});
