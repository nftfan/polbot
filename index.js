const TelegramBot = require('node-telegram-bot-api');
const Web3 = require('web3');

// --- CONFIG ---
const BOT_TOKEN = '8206583869:AAHg-L0Atf_Y5zEI8DNfNdR7KIcJfDoDs94';
const POLYGON_RPC = 'https://polygon-rpc.com/';
const NFTFAN_TOKEN_ADDRESS = '0x2017Fcaea540d2925430586DC92818035Bfc2F50';
const DISTRIBUTOR_ADDRESS = '0x6Ee372b30C73Dd6087ba58F8C4a5Ca77F49BE0b3'; // same as in HTML

// --- SETUP WEB3 ---
const web3 = new Web3(POLYGON_RPC);

const nftfanAbi = [
  {
    "inputs": [{"internalType":"address","name":"account","type":"address"}],
    "name":"balanceOf",
    "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{"internalType":"uint8","name":"","type":"uint8"}],
    "stateMutability":"view",
    "type":"function"
  }
];

// Only need getSubdropScore from distributor ABI
const distributorAbi = [
  {
    "inputs":[{"internalType":"address","name":"wallet","type":"address"}],
    "name":"getSubdropScore",
    "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  }
];

const nftfanContract = new web3.eth.Contract(nftfanAbi, NFTFAN_TOKEN_ADDRESS);
const distributorContract = new web3.eth.Contract(distributorAbi, DISTRIBUTOR_ADDRESS);

// --- INIT BOT ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- FUNCTIONS ---
async function getBalances(walletAddress) {
  try {
    // POL/MATIC balance
    const polWei = await web3.eth.getBalance(walletAddress);
    const pol = parseFloat(web3.utils.fromWei(polWei, 'ether')).toFixed(4);

    // NFTFAN token balance
    const decimals = await nftfanContract.methods.decimals().call();
    const nftfanRaw = await nftfanContract.methods.balanceOf(walletAddress).call();
    const nftfanBalance = (BigInt(nftfanRaw) * 1000000000000n) / BigInt(10 ** decimals);
    const nftfan = nftfanBalance.toLocaleString('en-US');

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
      // keep defaults
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
  // exclude 0, O, I, l which are not in base58
  const solRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  const matches = text.match(solRegex) || [];
  // You can add more filters here if you get false positives
  return matches.length > 0;
}

// --- BOT LISTENER ---
bot.on('message', async (msg) => {
  if (!msg.text) return;

  const text = msg.text;
  const chatId = msg.chat.id;

  // 1) Handle EVM (Polygon) wallets
  const wallets = extractEvmWallets(text);
  for (const wallet of wallets) {
    await bot.sendMessage(chatId, `Fetching balances and Subfan Score for: ${wallet}...`);
    const balances = await getBalances(wallet);
    if (balances) {
      await bot.sendMessage(
        chatId,
        `Wallet: ${wallet}\n` +
        `POL Balance: ${balances.pol} POL\n` +
        `NFTFan Balance: ${balances.nftfan} NFTFan\n` +
        `Subfan Score: ${balances.subfanScore}\n` +
        `Estimated Earnings: ${balances.earnings}`
      );
    } else {
      await bot.sendMessage(chatId, `Failed to fetch data for: ${wallet}`);
    }
  }

  // 2) If message seems to contain a Solana wallet, send the SOL promo
  if (containsSolanaWallet(text)) {
    await bot.sendMessage(
      chatId,
      'To earn free $SOL open this link in the browser of your web3 wallet: ' +
      'nftfanstoken.com/n/subfans and score 1000 SUBFANS.'
    );
  }
});
