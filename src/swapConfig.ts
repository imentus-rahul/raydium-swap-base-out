export const swapConfig = {
  executeSwap: true, // Send tx when true, simulate tx when false
  useVersionedTransaction: false,
  tokenAAmount: 0.01, // Swap 0.01 SOL for USDC in this example
  tokenAAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Token to swap for the other, SOL in this case
  tokenBAddress: "So11111111111111111111111111111111111111112", // USDC address
  tokenBAmount: 0.000001, // Swap 0.01 USDC for SOL in this example
  slippage: 5, // 5% slippage
  // maxLamports: 1500000, // Micro lamports for priority fee
  maxLamports: 200000, // Micro lamports for priority fee
  direction: "out" as "in" | "out", // Swap direction: 'in' or 'out'
  liquidityFile: "trimmed_mainnet.json",
  // liquidityFile: "trimmed_mainnet_token_pair.json",
  maxRetries: 20,
};

// // Raydium SWAP | 
// buy | in: https://solana.fm/tx/5f2yrvgbtStvtWBDASQwc8rFXm42J1G6mRmfSyE929Pc2ji3Yugao8HoopkbbWAReTfUigRHhZYYmB9AYgQ2jcbd?cluster=mainnet-alpha
// buy | out: https://solana.fm/tx/3rH7GqXYrkPG5BApFL8hB46Z3qPVAcNWdiEijt9PuG1QbEJubD5YmhUmmDu1xQzqKTWzBiQV2rRYRCP8SijV5Rhv?cluster=mainnet-alpha
// sell | in: https://solana.fm/tx/2rck7fS8dmJ1ZAa4SdPAdf5M3VnkhvUXPEjxMDoNxFoKxvQqeMtJE1aGYRiBraE2HNsB1PGYjX8rukZ41EbB3wmE?cluster=mainnet-alpha
// sell | out: https://solana.fm/tx/3LeFqZgN9ztfjQ3BhC93evTc9qPR1sJKkzbzdNYfGBwPBQKx1Jiyt2udJZGf4P6d3pEknonFbrqfG98aPfKAvSkf?cluster=mainnet-alpha