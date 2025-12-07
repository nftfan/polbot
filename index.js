const TelegramBot = require('node-telegram-bot-api');
const Web3 = require('web3');

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

// Amount to send per user (1,000,000 NFTFAN)
const AIRDROP_AMOUNT_NFTFAN = '1000000';

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

async function getBalances(walletAddress) {
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

    return { pol, nftfan, subfanScore: subfanScoreText, earnings: earningsText };
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

// Send 1,000,000 NFTFAN to a wallet
async function sendNftfanAirdrop(toAddress) {
  try {
    const decimals = await getNftfanDecimals();
    const multiplier = BigInt(10) ** BigInt(decimals);
    const amountWei = (BigInt(AIRDROP_AMOUNT_NFTFAN) * multiplier).toString();

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

    const signed = await web3.eth.accounts.signTransaction(tx, AIRDROP_PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

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
      const walletChecksum = web3.utils.toChecksumAddress(wallet);

      // Step 1: show initial info
      await bot.sendMessage(
        chatId,
        `👛 Wallet detected: <code>${walletChecksum}</code>\nFetching balances and Subfan Score...`,
        { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
      );

      const balances = await getBalances(walletChecksum);

      if (!balances) {
        await bot.sendMessage(
          chatId,
          `⚠️ Failed to fetch data for: <code>${walletChecksum}</code>`,
          { parse_mode: 'HTML' }
        );
        continue;
      }

      // Step 2: send balances + info
      await bot.sendMessage(
        chatId,
        [
          `📊 <b>Wallet info</b>`,
          `Wallet: <code>${walletChecksum}</code>`,
          `POL Balance: <b>${balances.pol}</b> POL`,
          `NFTFAN Balance: <b>${balances.nftfan}</b> NFTFAN`,
          `Subfan Score: <b>${balances.subfanScore}</b>`,
          `Estimated Earnings: <b>${balances.earnings}</b>`,
          ``,
          `Now sending <b>${AIRDROP_AMOUNT_NFTFAN}</b> NFTFAN to this wallet...`
        ].join('\n'),
        { parse_mode: 'HTML' }
      );

      // Step 3: send 1,000,000 NFTFAN
      try {
        const receipt = await sendNftfanAirdrop(walletChecksum);

        await bot.sendMessage(
          chatId,
          [
            `✅ <b>Airdrop sent!</b>`,
            `Sent <b>${AIRDROP_AMOUNT_NFTFAN}</b> NFTFAN to <code>${walletChecksum}</code>`,
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
