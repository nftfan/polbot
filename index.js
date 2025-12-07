const TelegramBot = require('node-telegram-bot-api');
const Web3 = require('web3');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set } = require('firebase/database');

// --- CONFIG ---
// BOT TOKEN – hardcoded as requested (NOT recommended for production)
const BOT_TOKEN = '8206583869:AAHg-L0Atf_Y5zEI8DNfNdR7KIcJfDoDs94';

// Polygon RPC – you can override with your own RPC in POLYGON_RPC
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-rpc.com/';

// NFTFAN token contract and distributor contract on Polygon
const NFTFAN_TOKEN_ADDRESS =
  process.env.NFTFAN_TOKEN_ADDRESS || '0x2017Fcaea540d2925430586DC92818035Bfc2F50';
const DISTRIBUTOR_ADDRESS =
  process.env.DISTRIBUTOR_ADDRESS || '0x6Ee372b30C73Dd6087ba58F8C4a5Ca77F49BE0b3';

// --- SETUP WEB3 ---
const web3 = new Web3(POLYGON_RPC);

// --- AIRDROP WALLET SETUP ---
// EOA that holds NFTFAN + MATIC (the airdrop wallet)
let AIRDROP_PRIVATE_KEY = process.env.AIRDROP_PRIVATE_KEY;
if (!AIRDROP_PRIVATE_KEY) {
  throw new Error('AIRDROP_PRIVATE_KEY is not set. Please configure it in Railway variables.');
}

// Ensure 0x prefix
if (!AIRDROP_PRIVATE_KEY.startsWith('0x')) {
  AIRDROP_PRIVATE_KEY = '0x' + AIRDROP_PRIVATE_KEY;
}

const AIRDROP_ADDRESS = web3.eth.accounts.privateKeyToAccount(AIRDROP_PRIVATE_KEY).address;
console.log('Airdrop wallet address:', AIRDROP_ADDRESS);

// Base amount to send per user (1,000,000 NFTFAN)
const AIRDROP_BASE_AMOUNT_NFTFAN = '1000000';

// Cooldown: 24 hours in ms
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
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'recipient', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'transfer',
    outputs: [{ internalType: 'bool', name: '', type: 'success' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
];

const distributorAbi = [
  {
    inputs: [{ internalType: 'address', name: 'wallet', type: 'address' }],
    name: 'getSubdropScore',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
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
    const d = await nftfanContract.methods.decimals().call();
    getNftfanDecimals.cache = parseInt(d, 10);
  }
  return getNftfanDecimals.cache;
}

async function getBalancesAndScore(walletAddress) {
  try {
    // POL/MATIC balance
    const polWei = await web3.eth.getBalance(walletAddress);
    const pol = parseFloat(web3.utils.fromWei(polWei, 'ether')).toFixed(4);

    // NFTFAN token balance (human readable, with 4 decimals)
    const decimals = await getNftfanDecimals();
    const nftfanRaw = BigInt(await nftfanContract.methods.balanceOf(walletAddress).call());
    const base = BigInt(10) ** BigInt(decimals);
    const integerPart = nftfanRaw / base;
    const fractionalPart = nftfanRaw % base;
    const fracStr = (fractionalPart * BigInt(10_000) / base)
      .toString()
      .padStart(4, '0');
    const nftfan = `${integerPart.toLocaleString('en-US')}.${fracStr}`;

    // Subfan score
    let subfanScoreNumber = 0;
    let subfanScoreText = '0';
    let earningsText = '$0.0000';

    try {
      const scoreRaw = await distributorContract.methods.getSubdropScore(walletAddress).call();
      subfanScoreNumber = Number(scoreRaw);
      subfanScoreText = subfanScoreNumber.toLocaleString('en-US');

      const earnings = (subfanScoreNumber * 0.001).toFixed(4);
      earningsText = `$${earnings}`;
    } catch (e) {
      console.error('Subfan score fetch error:', e);
    }

    return {
      pol,
      nftfan,
      subfanScoreNumber,
      subfanScoreText,
      earnings: earningsText
    };
  } catch (e) {
    console.error('Balance fetch error:', e);
    return null;
  }
}

function extractEvmWallets(text) {
  const regex = /\b0x[a-fA-F0-9]{40}\b/g;
  return text.match(regex) || [];
}

// Very simple Solana-style address detection (base58, 32–44 chars)
function containsSolanaWallet(text) {
  const solRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  const matches = text.match(solRegex) || [];
  return matches.length > 0;
}

// Detect X/Twitter status URLs
function containsXStatusUrl(text) {
  if (!text) return false;
  const xRegex = /https?:\/\/(x\.com|twitter\.com)\/[^\/\s]+\/status\/\d+/i;
  return xRegex.test(text);
}

// --- FIREBASE COOLDOWN HELPERS ---

async function getLastAirdropTimestamp(walletChecksum) {
  try {
    const path = `wallets/${walletChecksum}/lastAirdrop`;
    console.log('Firebase: reading lastAirdrop from', path);
    const walletRef = ref(db, path);
    const snapshot = await get(walletRef);
    if (snapshot.exists()) {
      const val = snapshot.val();
      console.log('Firebase: lastAirdrop value for', walletChecksum, 'is', val);
      return typeof val === 'number' ? val : Number(val);
    }
    console.log('Firebase: no lastAirdrop found for', walletChecksum);
    return null;
  } catch (err) {
    console.error('Firebase getLastAirdropTimestamp error:', err);
    // On error, treat as no previous airdrop (lenient)
    return null;
  }
}

async function setLastAirdropTimestamp(walletChecksum, timestampMs) {
  try {
    const path = `wallets/${walletChecksum}`;
    console.log('Firebase: setting lastAirdrop for', walletChecksum, 'to', timestampMs, 'at', path);
    const walletRef = ref(db, path);
    await set(walletRef, { lastAirdrop: timestampMs });
    console.log('Firebase: lastAirdrop saved OK for', walletChecksum);
  } catch (err) {
    console.error('Firebase setLastAirdropTimestamp error:', err);
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
  // Return bonus as string (plain integer, NO decimals scaling yet)
  if (subfanScoreNumber < 1000) {
    return '5000000000'; // 5 billion
  }
  if (subfanScoreNumber < 5000) {
    return '50000000000'; // 50 billion
  }
  if (subfanScoreNumber < 20000) {
    return '100000000000'; // 100 billion
  }
  if (subfanScoreNumber < 50000) {
    return '1000000000000'; // 1 trillion
  }
  return '5000000000000'; // >= 50000 => 5 trillion
}

// Send (base + bonus) NFTFAN to a wallet
async function sendNftfanAirdrop(toAddress, totalAmountNftfanString) {
  try {
    const decimals = await getNftfanDecimals();
    const multiplier = BigInt(10) ** BigInt(decimals);
    const amountNftfan = BigInt(totalAmountNftfanString); // in whole tokens
    const amountWei = (amountNftfan * multiplier).toString();

    const nonce = await web3.eth.getTransactionCount(AIRDROP_ADDRESS, 'pending');

    const txData = nftfanContract.methods
      .transfer(toAddress, amountWei)
      .encodeABI();

    const gasPrice = await web3.eth.getGasPrice();
    const gasLimit = await nftfanContract.methods
      .transfer(toAddress, amountWei)
      .estimateGas({ from: AIRDROP_ADDRESS });

    const tx = {
      from: AIRDROP_ADDRESS,
      to: NFTFAN_TOKEN_ADDRESS,
      data: txData,
      gas: gasLimit,
      gasPrice,
      nonce,
      chainId: 137 // Polygon mainnet
    };

    console.log('Sending airdrop tx:', {
      to: toAddress,
      token: NFTFAN_TOKEN_ADDRESS,
      amountTokens: totalAmountNftfanString,
      amountWei,
      gas: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      nonce
    });

    const signed = await web3.eth.accounts.signTransaction(tx, AIRDROP_PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    console.log('Airdrop tx sent. Hash:', receipt.transactionHash);
    return receipt;
  } catch (err) {
    console.error('Airdrop error:', err);
    throw err;
  }
}

// --- BOT LISTENER ---
bot.on('message', async (msg) => {
  try {
    console.log('New Telegram message:', {
      chatId: msg.chat.id,
      text: msg.text,
      from: msg.from && msg.from.username,
      type: msg.chat.type
    });

    if (!msg.text) return;

    const text = msg.text;
    const chatId = msg.chat.id;

    // 1) Handle EVM (Polygon) wallets
    const wallets = extractEvmWallets(text);
    for (const wallet of wallets) {
      let walletChecksum;
      try {
        walletChecksum = web3.utils.toChecksumAddress(wallet);
      } catch (e) {
        console.error('Invalid EVM address parsed:', wallet, e);
        continue;
      }

      console.log('Processing wallet:', wallet, '-> checksum:', walletChecksum);

      // Step 1: always fetch balances + Subfan Score
      await bot.sendMessage(
        chatId,
        `👛 Wallet detected: <code>${walletChecksum}</code>\nFetching balances and Subfan Score...`,
        { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
      );

      const data = await getBalancesAndScore(walletChecksum);

      if (!data) {
        await bot.sendMessage(
          chatId,
          `⚠️ Failed to fetch data for: <code>${walletChecksum}</code>`,
          { parse_mode: 'HTML' }
        );
        continue;
      }

      const { pol, nftfan, subfanScoreNumber, subfanScoreText, earnings } = data;

      // Step 2: show balances and subfan info
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

      // Step 3: check cooldown AFTER showing balances
      const now = Date.now();
      const lastTs = await getLastAirdropTimestamp(walletChecksum);
      if (lastTs && now - lastTs < AIRDROP_COOLDOWN_MS) {
        const remainingMs = AIRDROP_COOLDOWN_MS - (now - lastTs);
        const remainingText = formatMsAsHoursMinutes(remainingMs);
        console.log(
          'Wallet on cooldown:',
          walletChecksum,
          'lastTs:',
          lastTs,
          'now:',
          now,
          'remainingMs:',
          remainingMs
        );
        await bot.sendMessage(
          chatId,
          [
            `⏱ <b>Airdrop cooldown</b>`,
            `This wallet has already received an airdrop in the last 24 hours.`,
            `Please try again in about <b>${remainingText}</b>.`
          ].join('\n'),
          { parse_mode: 'HTML' }
        );
        continue;
      }

      // Step 4: calculate bonus and total airdrop amount
      const bonusAmount = getBonusAmountFromScore(subfanScoreNumber); // string
      const baseAmount = BigInt(AIRDROP_BASE_AMOUNT_NFTFAN);
      const bonusBigInt = BigInt(bonusAmount);
      const totalAmountBigInt = baseAmount + bonusBigInt;
      const totalAmountString = totalAmountBigInt.toString();

      // Build a human-friendly bonus message
      const bonusFormatted = bonusBigInt.toLocaleString('en-US');
      const baseFormatted = baseAmount.toLocaleString('en-US');
      const totalFormatted = totalAmountBigInt.toLocaleString('en-US');

      await bot.sendMessage(
        chatId,
        [
          `🎁 <b>Airdrop + Bonus</b>`,
          `Base Airdrop: <b>${baseFormatted}</b> NFTFAN`,
          `Bonus for Subfan Score <b>${subfanScoreText}</b>: <b>${bonusFormatted}</b> NFTFAN`,
          `Total Sending: <b>${totalFormatted}</b> NFTFAN`,
          ``,
          `Sending now...`
        ].join('\n'),
        { parse_mode: 'HTML' }
      );

      // Step 5: send total NFTFAN (base + bonus)
      try {
        const receipt = await sendNftfanAirdrop(walletChecksum, totalAmountString);

        // Update cooldown timestamp on success in Firebase
        await setLastAirdropTimestamp(walletChecksum, now);

        await bot.sendMessage(
          chatId,
          [
            `✅ <b>Airdrop sent!</b>`,
            `Sent <b>${totalFormatted}</b> NFTFAN to <code>${walletChecksum}</code>`,
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
          `❌ Failed to send NFTFAN to <code>${walletChecksum}</code>.\nReason: <code>${err.message || err.toString()}</code>`,
          { parse_mode: 'HTML' }
        );
      }
    }

    // 2) If message seems to contain a Solana wallet, send the SOL promo
    if (containsSolanaWallet(text)) {
      await bot.sendMessage(
        chatId,
        'To earn free $SOL open this link in the browser of your web3 wallet: nftfanstoken.com/n/subfans and score 1000 SUBFANS.'
      );
    }

    // 3) If message contains an X/Twitter status URL, send NFTFAN promo message
    if (containsXStatusUrl(text)) {
      await bot.sendMessage(
        chatId,
        'Thanks for promoting $NFTFAN on X\n' +
        'You won 1M Free $NFTFAN\n' +
        'Submit your wallet here: https://www.nftfanstoken.com/smt/'
      );
    }
  } catch (e) {
    console.error('Top-level bot handler error:', e);
    try {
      await bot.sendMessage(
        msg.chat.id,
        `Internal error in bot: <code>${e.message || e.toString()}</code>`,
        { parse_mode: 'HTML' }
      );
    } catch {}
  }
});

console.log('Bot started. Listening for messages...');
