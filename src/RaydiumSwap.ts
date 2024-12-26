import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, TransactionMessage, SystemProgram, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
  Liquidity,
  LiquidityPoolKeys,
  jsonInfo2PoolKeys,
  LiquidityPoolJsonInfo,
  TokenAccount,
  Token,
  TokenAmount,
  TOKEN_PROGRAM_ID,
  Percent,
  SPL_ACCOUNT_LAYOUT,
  Price,
} from '@raydium-io/raydium-sdk'
import { Wallet } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import fs from 'fs';
import path from 'path';
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddress, NATIVE_MINT } from '@solana/spl-token';

/**
 * Class representing a Raydium Swap operation.
 */
class RaydiumSwap {
  allPoolKeysJson: LiquidityPoolJsonInfo[]
  connection: Connection
  wallet: Wallet

  /**
 * Create a RaydiumSwap instance.
 * @param {string} RPC_URL - The RPC URL for connecting to the Solana blockchain.
 * @param {string} WALLET_PRIVATE_KEY - The private key of the wallet in base58 format.
 */
  constructor(RPC_URL: string, WALLET_PRIVATE_KEY: string) {
    this.connection = new Connection(RPC_URL
      , { commitment: 'confirmed' })
    this.wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(WALLET_PRIVATE_KEY))))
  }

  /**
  * Loads all the pool keys available from a JSON configuration file.
  * @async
  * @returns {Promise<void>}
  */
  async loadPoolKeys(liquidityFile: string) {
    let liquidityJson;
    if (liquidityFile.startsWith('http')) {
      const liquidityJsonResp = await fetch(liquidityFile);
      if (!liquidityJsonResp.ok) return;
      liquidityJson = await liquidityJsonResp.json();
    }
    else {
      liquidityJson = JSON.parse(fs.readFileSync(path.join(__dirname, liquidityFile), 'utf-8'));
    }
    const allPoolKeysJson = [...(liquidityJson?.official ?? []), ...(liquidityJson?.unOfficial ?? [])]

    this.allPoolKeysJson = allPoolKeysJson
  }

  /**
 * Finds pool information for the given token pair.
 * @param {string} mintA - The mint address of the first token.
 * @param {string} mintB - The mint address of the second token.
 * @returns {LiquidityPoolKeys | null} The liquidity pool keys if found, otherwise null.
 */
  findPoolInfoForTokens(mintA: string, mintB: string) {
    const poolData = this.allPoolKeysJson.find(
      (i) => (i.baseMint === mintA && i.quoteMint === mintB) || (i.baseMint === mintB && i.quoteMint === mintA)
    )

    if (!poolData) return null

    return jsonInfo2PoolKeys(poolData) as LiquidityPoolKeys
  }

  /**
 * Retrieves token accounts owned by the wallet.
 * @async
 * @returns {Promise<TokenAccount[]>} An array of token accounts.
 */
  async getOwnerTokenAccounts() {
    const walletTokenAccount = await this.connection.getTokenAccountsByOwner(this.wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })

    return walletTokenAccount.value.map((i) => ({
      pubkey: i.pubkey,
      programId: i.account.owner,
      accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }))
  }

  /**
 * Builds a swap transaction.
 * @async
 * @param {string} toToken - The mint address of the token to receive.
 * @param {number} amount - The amount of the token to swap.
 * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
 * @param {number} [maxLamports=100000] - The maximum lamports to use for transaction fees.
 * @param {boolean} [useVersionedTransaction=true] - Whether to use a versioned transaction.
 * @param {'in' | 'out'} [fixedSide='in'] - The fixed side of the swap ('in' or 'out').
 * @returns {Promise<Transaction | VersionedTransaction>} The constructed swap transaction.
 */
  async getSwapTransaction(
    toToken: string,
    // fromToken: string,
    amount: number,
    slippageX: number,
    poolKeys: LiquidityPoolKeys,
    maxLamports: number = 100000,
    useVersionedTransaction = true,
    fixedSide: 'in' | 'out' = 'in'
  ): Promise<Transaction | VersionedTransaction> {
    const directionIn = poolKeys.quoteMint.toString() == toToken
    const { minAmountOut, amountIn } = await this.calcAmountOut(poolKeys, amount, directionIn, slippageX)
    console.log({ minAmountOut, amountIn });
    const userTokenAccounts = await this.getOwnerTokenAccounts()
    const swapTransaction = await Liquidity.makeSwapInstructionSimple({
      connection: this.connection,
      makeTxVersion: useVersionedTransaction ? 0 : 1,
      poolKeys: {
        ...poolKeys,
      },
      userKeys: {
        tokenAccounts: userTokenAccounts,
        owner: this.wallet.publicKey,
      },
      amountIn: amountIn,
      amountOut: minAmountOut,
      fixedSide: fixedSide,
      config: {
        bypassAssociatedCheck: false,
      },
      computeBudgetConfig: {
        microLamports: maxLamports,
      },
    })

    const recentBlockhashForSwap = await this.connection.getLatestBlockhash()
    const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean)

    if (useVersionedTransaction) {
      const versionedTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: this.wallet.publicKey,
          recentBlockhash: recentBlockhashForSwap.blockhash,
          instructions: instructions,
        }).compileToV0Message()
      )

      versionedTransaction.sign([this.wallet.payer])

      return versionedTransaction
    }

    const legacyTransaction = new Transaction({
      blockhash: recentBlockhashForSwap.blockhash,
      lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
      feePayer: this.wallet.publicKey,
    })

    legacyTransaction.add(...instructions)

    return legacyTransaction
  }

  /**
 * Sends a legacy transaction.
 * @async
 * @param {Transaction} tx - The transaction to send.
 * @returns {Promise<string>} The transaction ID.
 */
  async sendLegacyTransaction(tx: Transaction, maxRetries?: number) {
    const txid = await this.connection.sendTransaction(tx, [this.wallet.payer], {
      skipPreflight: true,
      maxRetries: maxRetries,
    })

    return txid
  }

  /**
 * Sends a versioned transaction.
 * @async
 * @param {VersionedTransaction} tx - The versioned transaction to send.
 * @returns {Promise<string>} The transaction ID.
 */
  async sendVersionedTransaction(tx: VersionedTransaction, maxRetries?: number) {
    const txid = await this.connection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: maxRetries,
    })

    return txid
  }

  /**
    * Simulates a versioned transaction.
    * @async
    * @param {VersionedTransaction} tx - The versioned transaction to simulate.
    * @returns {Promise<any>} The simulation result.
    */
  async simulateLegacyTransaction(tx: Transaction) {
    const txid = await this.connection.simulateTransaction(tx, [this.wallet.payer])

    return txid
  }

  /**
 * Simulates a versioned transaction.
 * @async
 * @param {VersionedTransaction} tx - The versioned transaction to simulate.
 * @returns {Promise<any>} The simulation result.
 */
  async simulateVersionedTransaction(tx: VersionedTransaction) {
    const txid = await this.connection.simulateTransaction(tx)

    return txid
  }

  /**
 * Calculates the amount out for a swap.
 * @async
 * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
 * @param {number} rawAmountIn - The raw amount of the input token.
 * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
 * @returns {Promise<Object>} The swap calculation result.
 */
  async calcAmountOut(poolKeys: LiquidityPoolKeys, rawAmountIn: number, swapInDirection: boolean, slippageX: number) {
    const poolInfo = await Liquidity.fetchInfo({ connection: this.connection, poolKeys })

    let currencyInMint = poolKeys.baseMint
    let currencyInDecimals = poolInfo.baseDecimals
    let currencyOutMint = poolKeys.quoteMint
    let currencyOutDecimals = poolInfo.quoteDecimals

    if (!swapInDirection) {
      currencyInMint = poolKeys.quoteMint
      currencyInDecimals = poolInfo.quoteDecimals
      currencyOutMint = poolKeys.baseMint
      currencyOutDecimals = poolInfo.baseDecimals
    }

    const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
    const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
    const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
    const slippage = new Percent(slippageX, 100) // 5% slippage

    const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut,
      slippage,
    })

    return {
      amountIn,
      amountOut,
      minAmountOut,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
    }
  }


  /**
   * Calculates the amount in for a swap. 
   * @async
   * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
   * @param {number} rawAmountOut - The raw amount of the output token.
   * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
   * @returns {Promise<Object>} The swap calculation result.
   */
  async calcAmountIn(poolKeys: LiquidityPoolKeys, rawAmountOut: number, swapInDirection: boolean, slippageX: number) {
    const poolInfo = await Liquidity.fetchInfo({ connection: this.connection, poolKeys })

    console.log("poolKeys.quoteMint.toString()", poolKeys.quoteMint.toString())
    console.log("poolKeys.baseMint.toString()", poolKeys.baseMint.toString())

    let currencyInMint = poolKeys.baseMint
    let currencyInDecimals = poolInfo.baseDecimals
    let currencyOutMint = poolKeys.quoteMint
    let currencyOutDecimals = poolInfo.quoteDecimals

    if (!swapInDirection) {
      currencyInMint = poolKeys.quoteMint
      currencyInDecimals = poolInfo.quoteDecimals
      currencyOutMint = poolKeys.baseMint
      currencyOutDecimals = poolInfo.baseDecimals
    }

    // CHECK
    if (currencyInMint.toString() != NATIVE_MINT.toString()) {
      console.log("currencyInMint.toString()", currencyInMint.toString())
      console.error("ERROR: currencyInMint is not NATIVE_MINT")
      return
    }

    const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
    const amountOut = new TokenAmount(currencyIn, rawAmountOut, false)
    console.log("amountOut: ", amountOut.toExact())
    const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
    const slippage = new Percent(slippageX, 100) // 5% slippage

    const { amountIn, maxAmountIn, currentPrice, executionPrice, priceImpact } = Liquidity.computeAmountIn({
      poolKeys,
      poolInfo,
      amountOut,
      currencyIn,
      slippage
    });

    return {
      amountIn,
      maxAmountIn,
      currentPrice,
      executionPrice,
      priceImpact,
      amountOut,
      currencyInMint,
      currencyOutMint,
      currencyInDecimals,
      currencyOutDecimals,
    }
  }

  /**
* Builds a swap transaction.
* @async
* @param {string} toToken - The mint address of the token to receive.
* @param {number} amount - The amount of the token to swap.
* @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
* @param {number} [maxLamports=100000] - The maximum lamports to use for transaction fees.
* @param {boolean} [useVersionedTransaction=true] - Whether to use a versioned transaction.
* @param {'in' | 'out'} [fixedSide='in'] - The fixed side of the swap ('in' or 'out').
* @returns {Promise<Transaction | VersionedTransaction>} The constructed swap transaction.
*/
  async getSwapOutTransaction(
    toToken: string,
    // fromToken: string,
    amount: number, // this is amount out
    slippageX: number,
    poolKeys: LiquidityPoolKeys,
    maxLamports: number = 100000,
    useVersionedTransaction = true,
    fixedSide: 'in' | 'out' = 'in'
  ): Promise<Transaction | VersionedTransaction> {
    const directionIn = poolKeys.quoteMint.toString() == toToken
    console.log("directionIn", directionIn)
    const { maxAmountIn, amountIn, currentPrice, executionPrice, priceImpact,
      amountOut,
      currencyInMint,
      currencyOutMint,
      currencyInDecimals,
      currencyOutDecimals, } = await this.calcAmountIn(poolKeys, amount, directionIn, slippageX)

    console.log("Max Amount In: ", maxAmountIn.toExact())
    console.log("Amount In: ", amountIn.toExact())
    console.log("Amount Out: ", amountOut.toExact())
    console.log("Current Price: ", currentPrice.toFixed())
    console.log("Execution Price: ", executionPrice.toFixed())
    console.log("Price Impact: ", priceImpact)


    let tokenInUserATA = await getAssociatedTokenAddress(
      currencyInMint,
      this.wallet.publicKey
    );
    let tokenOutUserATA = await getAssociatedTokenAddress(
      currencyOutMint,
      this.wallet.publicKey
    );

    console.log("tokenInUserATA: ", tokenInUserATA.toString())
    console.log("tokenOutUserATA: ", tokenOutUserATA.toString())


    // poolKeys: LiquidityPoolKeys
    // userKeys: {
    //   tokenAccountIn: PublicKey
    //   tokenAccountOut: PublicKey
    //   owner: PublicKey
    // }
    // // maximum amount in
    // maxAmountIn: BigNumberish
    // amountOut: BigNumberish

    const swapIx = Liquidity.makeSwapFixedOutInstruction(
      {
        // connection: this.connection,
        // makeTxVersion: useVersionedTransaction ? 0 : 1,
        poolKeys: {
          ...poolKeys,
        },
        userKeys: {
          tokenAccountIn: tokenInUserATA,
          tokenAccountOut: tokenOutUserATA,
          owner: this.wallet.publicKey,
        },
        maxAmountIn: maxAmountIn.raw,
        amountOut: amountOut.raw,
        // fixedSide: fixedSide,
        // config: {
        //   bypassAssociatedCheck: false,
        // },
        // computeBudgetConfig: {
        //   microLamports: maxLamports,
        // },
      },
      poolKeys.version,
    )



    let recentBlockhashForSwap = await this.connection.getLatestBlockhash()

    if (useVersionedTransaction) {
      let instructions = []
      if (currencyInMint.toString() == NATIVE_MINT.toString()) {
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: this.wallet.publicKey,
            toPubkey: tokenInUserATA,
            lamports: amountIn.raw.toNumber(),
          }),
          createSyncNativeInstruction(tokenInUserATA, TOKEN_PROGRAM_ID),
          ...swapIx.innerTransaction.instructions,
        )
      } else {
        instructions = [
          ...swapIx.innerTransaction.instructions,
        ]
      }

      const versionedTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: this.wallet.publicKey,
          recentBlockhash: recentBlockhashForSwap.blockhash,
          instructions: instructions,
        }).compileToV0Message()
      )

      versionedTransaction.sign([this.wallet.payer])

      return versionedTransaction
    }

    const legacyTransaction = new Transaction({
      blockhash: recentBlockhashForSwap.blockhash,
      lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
      feePayer: this.wallet.publicKey,
    })

    // // The funds require to make a swap are now available in User's wSOL ATA
    if (currencyInMint.toString() == NATIVE_MINT.toString()) {

      legacyTransaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 744_452 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 183_504 }),
      )

      legacyTransaction.add(
        createAssociatedTokenAccountIdempotentInstruction(
          this.wallet.publicKey,
          tokenInUserATA,
          this.wallet.publicKey,
          currencyInMint,
        ),
      )

      console.log("Adding sync native instruction for SOL -> WSOL")
      // Convert SOL to Wrapped SOL
      legacyTransaction.add(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: tokenInUserATA,
          lamports: maxAmountIn.raw.toNumber(),
        }),
        createSyncNativeInstruction(tokenInUserATA, TOKEN_PROGRAM_ID) // SOL -> WSOL
      );
    }

    legacyTransaction.add(...swapIx.innerTransaction.instructions)

    return legacyTransaction
  }


  async getSwapInTransactionViaTradeAPI(poolKeys: LiquidityPoolKeys, amount: number, slippageX: number) {

    

  }

  async convertToWrapSol(amount: number): Promise<Transaction | VersionedTransaction> {

    let recentBlockhashForWrapSol = await this.connection.getLatestBlockhash()

    let tokenInUserATA = await getAssociatedTokenAddress(
      NATIVE_MINT,
      this.wallet.publicKey
    );

    let legacyTransaction = new Transaction({
      blockhash: recentBlockhashForWrapSol.blockhash,
      lastValidBlockHeight: recentBlockhashForWrapSol.lastValidBlockHeight,
      feePayer: this.wallet.publicKey,
    })

    legacyTransaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 744_452 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 183_504 }),
    )

    legacyTransaction.add(
      SystemProgram.transfer({
        fromPubkey: this.wallet.publicKey,
        toPubkey: tokenInUserATA,
        lamports: amount * LAMPORTS_PER_SOL,
      }),
      createSyncNativeInstruction(tokenInUserATA, TOKEN_PROGRAM_ID)
    )

    return legacyTransaction
  }

}

export default RaydiumSwap