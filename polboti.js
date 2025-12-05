const TelegramBot = require('node-telegram-bot-api');
const Web3 = require('web3');

// --- CONFIG ---
const BOT_TOKEN = '8206583869:AAHg-L0Atf_Y5zEI8DNfNdR7KIcJfDoDs94';
const CHAT_ID = '2141064153';
const POLYGON_RPC = '[https://polygon-rpc.com/](https://polygon-rpc.com/)';
const NFTFAN_TOKEN_ADDRESS = '0x2017Fcaea540d2925430586DC92818035Bfc2F50';

// --- SETUP WEB3 ---
const web3 = new Web3(POLYGON_RPC);
const nftfanAbi = [
{ "inputs": [{"internalType":"address","name":"account","type":"address"}], "name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view", "type":"function" },
{ "inputs": [], "name": "decimals", "outputs": [{"internalType":"uint8","name":"","type":"uint8"}], "stateMutability":"view", "type":"function" }
];
const nftfanContract = new web3.eth.Contract(nftfanAbi, NFTFAN_TOKEN_ADDRESS);

// --- INIT BOT ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- FUNCTIONS ---
async function getBalances(walletAddress) {
try {
const polWei = await web3.eth.getBalance(walletAddress);
const pol = parseFloat(web3.utils.fromWei(polWei, 'ether')).toFixed(4);

```
    const decimals = await nftfanContract.methods.decimals().call();
    const nftfanRaw = await nftfanContract.methods.balanceOf(walletAddress).call();
    const nftfanBalance = (BigInt(nftfanRaw) * 1000000000000n) / BigInt(10 ** decimals);
    const nftfan = nftfanBalance.toLocaleString('en-US');

    return { pol, nftfan };
} catch (e) {
    console.error('Balance fetch error:', e);
    return null;
}
```

}

function extractWallets(text) {
const regex = /\b0x[a-fA-F0-9]{40}\b/g;
return text.match(regex) || [];
}

// --- BOT LISTENER ---
bot.on('message', async (msg) => {
if (msg.chat.id.toString() !== CHAT_ID) return;
if (!msg.text) return;

```
const wallets = extractWallets(msg.text);
if (wallets.length === 0) return;

for (const wallet of wallets) {
    bot.sendMessage(CHAT_ID, `Fetching balances for: ${wallet}...`);
    const balances = await getBalances(wallet);
    if (balances) {
        bot.sendMessage(CHAT_ID,
            `Wallet: ${wallet}\n` +
            `POL Balance: ${balances.pol} POL\n` +
            `NFTFan Balance: ${balances.nftfan} NFTFan`
        );
    } else {
        bot.sendMessage(CHAT_ID, `Failed to fetch balances for: ${wallet}`);
    }
}
```

});
