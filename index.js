const TelegramBot = require('node-telegram-bot-api');
const Web3 = require('web3');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set } = require('firebase/database');

// --- CONFIG ---
const BOT_TOKEN = '8206583869:AAHg-L0Atf_Y5zEI8DNfNdR7KIcJfDoDs94';
const TARGET_CHAT_ID = -1001835894609;

// Your Polygonscan API Key (Used for reading balances reliably)
const POLYGONSCAN_API_KEY = 'Z7UUSFGES3UDZ8RMWVAWF9HA59IAJA83XJ';

// Using dRPC as the fallback RPC for writing transactions (Airdrop)
// If this ever fails, other good free options are 'https://polygon-bor-rpc.publicnode.com' or 'https://1rpc.io/matic'
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon.drpc.org';

const NFTFAN_TOKEN_ADDRESS = process.env.NFTFAN_TOKEN_ADDRESS || '0x2017Fcaea540d2925430586DC92818035Bfc2F50';
const DISTRIBUTOR_ADDRESS = process.env.DISTRIBUTOR_ADDRESS || '0x6Ee372b30C73Dd6087ba58F8C4a5Ca77F49BE0b3';

// --- SETUP WEB3 ---
const web3 = new Web3(new Web3.providers.HttpProvider(POLYGON_RPC, { timeout: 15000 }));

// --- AIRDROP WALLET SETUP ---
let AIRDROP_PRIVATE_KEY = process.env.AIRDROP_PRIVATE_KEY;
if (!AIRDROP_PRIVATE_KEY) {
  throw new Error('AIRDROP_PRIVATE_KEY is not set. Please configure it in Railway variables.');
}

if (!AIRDROP_PRIVATE_KEY.startsWith('0x')) {
  AIRDROP_PRIVATE_KEY = '0x' + AIRDROP_PRIVATE_KEY;
}

const AIRDROP_ADDRESS = web3.eth.accounts.privateKeyToAccount(AIRDROP_PRIVATE_KEY).address;
console.log('Airdrop wallet address:', AIRDROP_ADDRESS);

const AIRDROP_BASE_AMOUNT_NFTFAN = '1000000';
const AIRDROP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: "AIzaSyBuBB-Cha7eLG1O7SxOTfFt8e6hVAWjkxI",
  authDomain: "tokentransfer-4a9b3.firebaseapp.com",
  databaseURL: "https://tokentransfer-4a9b3-default-rtdb.firebaseio.com",
  projectId: "tokentransfer-4a9b3",
  storageBucket: "tokentransfer-4a9b3.firebasestorage.app",
  messagingSenderId: "205455490321",
  appId: "1:205455490321:web:9919f5dde059316c9320b0",
  measurementId: "G-Y6CVEDL9XH"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// --- ABIs ---
const nftfanAbi = [
  { inputs: [], name: 'decimals', outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'recipient', type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ internalType: 'bool', name: '', type: 'success' }], stateMutability: 'nonpayable', type: 'function' }
];

const distributorAbi = [
  { inputs: [{ internalType: 'address', name: 'wallet', type: 'address' }], name: 'getSubdropScore', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }
];

const nftfanContract = new web3.eth.Contract(nftfanAbi, NFTFAN_TOKEN_ADDRESS);
const distributorContract = new web3.eth.Contract(distributorAbi, DISTRIBUTOR_ADDRESS);

// --- INIT BOT ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
  console.error('Polling error:', err);
});

// --- HELPERS ---

async function getNftfanDecimals() {
  if (!getNftfanDecimals.cache) {
    try {
      const d = await nftfanContract.methods.decimals().call();
      getNftfanDecimals.cache = parseInt(d, 10);
    } catch (e) {
      return 18; // Default to 18 decimals on failure
    }
  }
  return getNftfanDecimals.cache;
}

// Fetch balances safely using Polygonscan API key (Bypasses RPC overload)
async function getBalancesAndScore(walletAddress) {
  let pol = '0.0000';
  let nftfan = '0.0000';
  let subfanScoreNumber = 0;
  let subfanScoreText = '0';
  let earningsText = '$0.0000';

  // 1. Fetch POL Balance via Polygonscan API
  try {
    const polRes = await fetch(`https://api.polygonscan.com/api?module=account&action=balance&address=${walletAddress}&tag=latest&apikey=${POLYGONSCAN_API_KEY}`);
    const polData = await polRes.json();
    if (polData.status === '1' && polData.result) {
      pol = parseFloat(web3.utils.fromWei(polData.result, 'ether')).toFixed(4);
    }
  } catch (e) {
    console.error(`POL fetch error for ${walletAddress}:`, e.message);
  }

  // 2. Fetch NFTFAN Balance via Polygonscan API
  try {
    const tokenRes = await fetch(`https://api.polygonscan.com/api?module=account&action=tokenbalance&contractaddress=${NFTFAN_TOKEN_ADDRESS}&address=${walletAddress}&tag=latest&apikey=${POLYGONSCAN_API_KEY}`);
    const tokenData = await tokenRes.json();
    if (tokenData.status === '1' && tokenData.result) {
      const decimals = await getNftfanDecimals();
      const nftfanRaw = BigInt(tokenData.result);
      const base = BigInt(10) ** BigInt(decimals);
      const integerPart = nftfanRaw / base;
      const fractionalPart = nftfanRaw % base;
      const fracStr = (fractionalPart * BigInt(10_000) / base).toString().padStart(4, '0');
      nftfan = `${integerPart.toLocaleString('en-US')}.${fracStr}`;
    }
  } catch (e) {
    console.error(`NFTFAN fetch error for ${walletAddress}:`, e.message);
  }

  // 3. Fetch Subfan Score via RPC (Web3 call to specific contract)
  try {
    const scoreRaw = await distributorContract.methods.getSubdropScore(walletAddress).call();
    subfanScoreNumber = Number(scoreRaw);
    subfanScoreText = subfanScoreNumber.toLocaleString('en-US');
    const earnings = (subfanScoreNumber * 0.001).toFixed(4);
    earningsText = `$${earnings}`;
  } catch (e) {
    console.error(`Subfan score fetch error for ${walletAddress}:`, e.message);
  }

  return { pol, nftfan, subfanScoreNumber, subfanScoreText, earnings: earningsText };
}

function extractEvmWallets(text) {
  const regex = /\b0x[a-fA-F0-9]{40}\b/g;
  return text.match(regex) || [];
}

function containsSolanaWallet(text) {
  const solRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  return (text.match(solRegex) || []).length > 0;
}

function containsXStatusUrl(text) {
  if (!text) return false;
  return /https?:\/\/(x\.com|twitter\.com)\/[^\/\s]+\/status\/\d+/i.test(text);
}

// --- FIREBASE COOLDOWN HELPERS ---

async function getLastAirdropTimestamp(walletChecksum) {
  try {
    const snapshot = await get(ref(db, `wallets/${walletChecksum}/lastAirdrop`));
    return snapshot.exists() ? Number(snapshot.val()) : null;
  } catch (err) {
    return null;
  }
}

async function setLastAirdropTimestamp(walletChecksum, timestampMs) {
  try {
    await set(ref(db, `wallets/${walletChecksum}`), { lastAirdrop: timestampMs });
  } catch (err) {
    console.error('Firebase save error:', err);
  }
}

function formatMsAsHoursMinutes(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours <= 0 && minutes <= 0) return 'a few minutes';
  if (hours <= 0) return `${minutes} minute(s)`;
  if (minutes <= 0) return `${hours} hour(s)`;
  return `${hours} hour(s) ${minutes} minute(s)`;
}

// --- BONUS LOGIC ---

function getBonusAmountFromScore(subfanScoreNumber) {
  if (subfanScoreNumber < 1000) return '5000000000';
  if (subfanScoreNumber < 5000) return '50000000000';
  if (subfanScoreNumber < 20000) return '100000000000';
  if (subfanScoreNumber < 50000) return '1000000000000';
  return '5000000000000';
}

async function sendNftfanAirdrop(toAddress, totalAmountNftfanString) {
  const decimals = await getNftfanDecimals();
  const multiplier = BigInt(10) ** BigInt(decimals);
  const amountWei = (BigInt(totalAmountNftfanString) * multiplier).toString();

  const nonce = await web3.eth.getTransactionCount(AIRDROP_ADDRESS, 'pending');
  const txData = nftfanContract.methods.transfer(toAddress, amountWei).encodeABI();
  const gasPrice = await web3.eth.getGasPrice();
  
  const gasLimit = await nftfanContract.methods.transfer(toAddress, amountWei).estimateGas({ from: AIRDROP_ADDRESS });

  const tx = {
    from: AIRDROP_ADDRESS,
    to: NFTFAN_TOKEN_ADDRESS,
    data: txData,
    gas: gasLimit,
    gasPrice,
    nonce,
    chainId: 137
  };

  const signed = await web3.eth.accounts.signTransaction(tx, AIRDROP_PRIVATE_KEY);
  return await web3.eth.sendSignedTransaction(signed.rawTransaction);
}

// --- BOT LISTENER ---
bot.on('message', async (msg) => {
  if (!msg.text) return;

  const text = msg.text;
  const chatId = msg.chat.id;

  const wallets = extractEvmWallets(text);
  for (const wallet of wallets) {
    let walletChecksum;
    try {
      walletChecksum = web3.utils.toChecksumAddress(wallet);
    } catch (e) {
      continue;
    }

    await bot.sendMessage(
      chatId,
      `👛 Wallet detected: <code>${walletChecksum}</code>\nFetching balances and Subfan Score...`,
      { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
    );

    const data = await getBalancesAndScore(walletChecksum);
    const { pol, nftfan, subfanScoreNumber, subfanScoreText, earnings } = data;

    await bot.sendMessage(
      chatId,
      [
        `📊 <b>Wallet info</b>`,
        `Wallet: <code>${walletChecksum}</code>`,
        `POL Balance: <b>${pol}</b> POL`,
        `NFTFAN Balance: <b>${nftfan}</b> NFTFAN`,
        `Subfan Score: <b>${subfanScoreText}</b>`,
        `Estimated Earnings: <b>${earnings}</b>`
      ].join('\n'),
      { parse_mode: 'HTML' }
    );

    const now = Date.now();
    const lastTs = await getLastAirdropTimestamp(walletChecksum);
    
    // Skip cooldown check for testing/debug if needed, but keeping it as requested
    if (lastTs && now - lastTs < AIRDROP_COOLDOWN_MS) {
      const remainingMs = AIRDROP_COOLDOWN_MS - (now - lastTs);
      await bot.sendMessage(
        chatId,
        `⏱ <b>Airdrop cooldown</b>\nThis wallet already received an airdrop today.\nPlease try again in about <b>${formatMsAsHoursMinutes(remainingMs)}</b>.`,
        { parse_mode: 'HTML' }
      );
      continue; // Skip the rest of the loop for this wallet
    }

    const bonusAmount = getBonusAmountFromScore(subfanScoreNumber);
    const totalAmountBigInt = BigInt(AIRDROP_BASE_AMOUNT_NFTFAN) + BigInt(bonusAmount);
    const totalAmountString = totalAmountBigInt.toString();

    await bot.sendMessage(
      chatId,
      [
        `🎁 <b>Airdrop + Bonus</b>`,
        `Base Airdrop: <b>${BigInt(AIRDROP_BASE_AMOUNT_NFTFAN).toLocaleString('en-US')}</b> NFTFAN`,
        `Bonus for Subfan Score <b>${subfanScoreText}</b>: <b>${BigInt(bonusAmount).toLocaleString('en-US')}</b> NFTFAN`,
        `Total Sending: <b>${totalAmountBigInt.toLocaleString('en-US')}</b> NFTFAN`,
        ``,
        `Sending now...`
      ].join('\n'),
      { parse_mode: 'HTML' }
    );

    try {
      const receipt = await sendNftfanAirdrop(walletChecksum, totalAmountString);
      
      // Update firebase only if transaction was successful
      await setLastAirdropTimestamp(walletChecksum, now);

      await bot.sendMessage(
        chatId,
        [
          `✅ <b>Airdrop sent!</b>`,
          `Sent <b>${totalAmountBigInt.toLocaleString('en-US')}</b> NFTFAN to <code>${walletChecksum}</code>`,
          `Tx hash: <code>${receipt.transactionHash}</code>`,
          ``,
          `You can view it on Polygonscan:`,
          `https://polygonscan.com/tx/${receipt.transactionHash}`
        ].join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      await bot.sendMessage(
        chatId,
        `❌ Failed to send NFTFAN to <code>${walletChecksum}</code>.\nReason: <code>${err.message || "Transaction failed"}</code>`,
        { parse_mode: 'HTML' }
      );
    }
  }

  if (containsSolanaWallet(text)) {
    await bot.sendMessage(chatId, 'Sending free 0.1 $SOL ... sending failed, open this link in the browser of your web3 wallet: nftfanstoken.com/n/subfans and score 1000 SUBFANS.');
  }

  if (containsXStatusUrl(text)) {
    await bot.sendMessage(chatId, 'Thanks for promoting $NFTFAN on X\nYou won 1M Free $NFTFAN\nSubmit your wallet here: https://www.nftfanstoken.com/smt/');
  }
});

// --- SCHEDULED MESSAGES ---
setInterval(() => {
  bot.sendMessage(TARGET_CHAT_ID, 'To buy $NFTFAN tokens send $POL to token sale smart contract: <code>0xaf2d132C8773bca3821C24EcF64e844E202A12e8</code>\nFor 1 $POL you receive 1000T $NFTFAN\nOr visit: https://www.nftfanstoken.com/quickbuynft/', { parse_mode: 'HTML' }).catch(() => {});
}, 60 * 60 * 1000);

setInterval(() => {
  bot.sendMessage(TARGET_CHAT_ID, 'Keep going friends, $NFTFAN to the moon! Keep scoring Subfans and growing the community.').catch(() => {});
}, 100 * 60 * 1000);

const COOL_MESSAGES = [
  '🔥 $NFTFAN grinders, every Subfan scored today is a future airdrop tomorrow. Stay active!',
  '🚀 $NFTFAN + Subfans = double power. Share your wallet, check your score, and stack those tokens.',
  '🎯 Target: more Subfans, more volume, more hype. $NFTFAN is just getting started.',
  '🌕 Road to the moon: hold, earn, share. Subfan score is your ticket to bigger drops.',
  '💎 Diamond hands on $NFTFAN, paper hands get left behind. Keep scoring Subfans.',
];

function scheduleRandomCoolMessage() {
  const minMs = 70 * 60 * 1000;
  const maxMs = 110 * 60 * 1000;
  setTimeout(() => {
    bot.sendMessage(TARGET_CHAT_ID, COOL_MESSAGES[Math.floor(Math.random() * COOL_MESSAGES.length)]).catch(() => {});
    scheduleRandomCoolMessage();
  }, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
}
scheduleRandomCoolMessage();

console.log('Bot started. Using dRPC for transactions and Polygonscan API for balances...');
