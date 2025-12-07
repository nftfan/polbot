// --- BOT LISTENER ---
bot.on('message', async (msg) => {
  try {
    console.log('New Telegram message:', {
      chatId: msg.chat.id,
      text: msg.text,
      from: msg.from && msg.from.username,
      type: msg.chat.type
    });

    // TEMP: log chat ID so you can set TARGET_CHAT_ID
    console.log('Chat ID:', msg.chat.id);

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
        'Sending free 0.1 $SOL ... sending failed, open this link in the browser of your web3 wallet: nftfanstoken.com/n/subfans and score 1000 SUBFANS.'
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
